// Column filters and sorting for the admin data grids (/datatable/admin/*/data).
//
// Query parameters (all optional; the first three already existed):
//   search        global text search (each endpoint keeps its own list of columns)
//   order_column  / order_dir   sort key and direction
//   col_searches  {"key": "text"}                     contains match (LIKE %text%)
//   col_exact     {"key": ["a", "b"]}                 exact match on any of the values
//   col_ranges    {"key": {"from": x, "to": y, "unit": "tat_hours"}}
//                 inclusive range on dates (YYYY-MM-DD) or numbers; unit "tat_hours" reads
//                 TAT strings such as "42h 54.0000m" as hours
//
// Every endpoint lists the SQL expression of the keys it can filter in its own WHERE
// (`directMap`, cheap). Keys that only exist as select-list aliases (TATs, counters, joined
// names...) are filtered and sorted on an outer query over the endpoint's full SELECT:
// correct for every column, but slower, so it is only used when such a key is involved.

const { sequelize } = require('../config/databaseConfig');

const KEY_RE = /^[a-z][a-z0-9_]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const MAX_EXACT_VALUES = 200;

function parseJsonObject(value) {
    if (!value) return {};
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
        return {};
    }
}

function parseBound(value) {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    if (DATE_RE.test(text)) return { kind: 'date', value: text };
    if (NUMBER_RE.test(text)) return { kind: 'number', value: Number(text) };
    return null;
}

/**
 * Reads col_searches / col_exact / col_ranges into a flat list of filters.
 * Keys are restricted to [a-z0-9_]; each endpoint still decides which keys exist.
 */
function parseGridFilters(query) {
    const filters = [];
    for (const [rawKey, value] of Object.entries(parseJsonObject(query.col_searches))) {
        const key = rawKey.trim();
        if (!KEY_RE.test(key) || value === null || value === undefined || String(value).trim() === '') continue;
        filters.push({ key, type: 'contains', value: String(value) });
    }
    for (const [key, value] of Object.entries(parseJsonObject(query.col_exact))) {
        if (!KEY_RE.test(key)) continue;
        const values = (Array.isArray(value) ? value : [value])
            .filter(v => v !== null && v !== undefined && v !== '' && typeof v !== 'object')
            .map(String)
            .slice(0, MAX_EXACT_VALUES);
        if (values.length) filters.push({ key, type: 'exact', values });
    }
    for (const [key, value] of Object.entries(parseJsonObject(query.col_ranges))) {
        if (!KEY_RE.test(key) || !value || typeof value !== 'object') continue;
        const from = parseBound(value.from);
        const to = parseBound(value.to);
        if (from || to) filters.push({ key, type: 'range', from, to, unit: value.unit === 'tat_hours' ? 'tat_hours' : null });
    }
    return filters;
}

// "42h 54.0000m" / "00h 00m" -> hours (NULL when the text has no "h")
function tatHoursSql(expr) {
    return `(CASE WHEN ${expr} LIKE '%h%' THEN CAST(TRIM(SUBSTRING_INDEX(${expr}, 'h', 1)) AS DECIMAL(20,4))
        + COALESCE(CAST(TRIM(REPLACE(SUBSTRING_INDEX(${expr}, 'h', -1), 'm', '')) AS DECIMAL(20,4)), 0) / 60 END)`;
}

function rangeConditions(filter, expr, replacements, param) {
    const conditions = [];
    [['from', '>='], ['to', '<=']].forEach(([side, op]) => {
        const bound = filter[side];
        if (!bound) return;
        const name = `${param}_${side}`;
        replacements[name] = bound.value;
        if (bound.kind === 'date') {
            conditions.push(`DATE(${expr}) ${op} :${name}`);
        } else if (filter.unit === 'tat_hours') {
            conditions.push(`${tatHoursSql(expr)} ${op} :${name}`);
        } else {
            conditions.push(`CAST(${expr} AS DECIMAL(20,4)) ${op} :${name}`);
        }
    });
    return conditions;
}

function filterConditions(filter, expr, replacements, param) {
    if (filter.type === 'contains') {
        replacements[param] = `%${filter.value}%`;
        return [`${expr} LIKE :${param}`];
    }
    if (filter.type === 'exact') {
        replacements[param] = filter.values;
        return [`${expr} IN (:${param})`];
    }
    return rangeConditions(filter, expr, replacements, param);
}

/** Select-list aliases of a SQL SELECT (`... AS alias,` or `... AS alias` before FROM). */
function selectAliases(selectSql) {
    const aliases = new Set();
    for (const match of selectSql.matchAll(/\bAS\s+`?([a-z][a-z0-9_]*)`?\s*(?=,|\bFROM\b|$)/gi)) {
        aliases.add(match[1]);
    }
    return aliases;
}

/**
 * Splits the parsed filters into conditions for the endpoint's own WHERE (keys in directMap)
 * and conditions for the outer query (keys that are only select aliases, `outerKeys`).
 * Pushes the direct ones onto `whereClauses`; unknown keys are ignored (as before).
 */
function applyGridFilters({ filters, directMap, outerKeys, whereClauses, replacements }) {
    const outerConditions = [];
    filters.forEach((filter, index) => {
        const param = `gridFilter${index}`;
        if (Object.prototype.hasOwnProperty.call(directMap, filter.key)) {
            whereClauses.push(...filterConditions(filter, directMap[filter.key], replacements, param));
        } else if (outerKeys && outerKeys.has(filter.key)) {
            outerConditions.push(...filterConditions(filter, `x.\`${filter.key}\``, replacements, param));
        }
    });
    return outerConditions;
}

/**
 * Sort key for the outer query: used when the requested key is a valid alias but cannot be
 * sorted in the endpoint's own query (or when the outer query runs anyway).
 */
function resolveSort(query, outerKeys) {
    const key = query.order_column;
    const dir = String(query.order_dir || '').toUpperCase();
    if (!key || !KEY_RE.test(key) || !['ASC', 'DESC'].includes(dir) || !outerKeys.has(key)) return null;
    return { key, dir };
}

/**
 * ORDER BY expression for a resolved sort. TAT columns hold text such as "9h 5m", which sorts
 * alphabetically ("9h" after "48h"), so they are ordered by their value in hours.
 * `prefix` is "" for the endpoint's own query (select alias) or "x." for the outer query.
 */
function orderSql(sort, prefix = '') {
    const column = `${prefix}\`${sort.key}\``;
    return /_tat(_|$)/.test(sort.key) ? `${tatHoursSql(column)} ${sort.dir}` : `${column} ${sort.dir}`;
}

/**
 * Runs the endpoint's full query as a derived table with the outer filters / sort applied.
 * `summary` maps output keys to aggregate SQL over `x` (e.g. "SUM(x.task_status = 'completed')").
 */
async function runOuterQuery({ innerSql, replacements, outerConditions, sort, defaultOrder, limit, offset, summary }) {
    const whereSql = outerConditions.length ? `WHERE ${outerConditions.join(' AND ')}` : '';
    const order = sort ? `${orderSql(sort, 'x.')}, ${defaultOrder}` : defaultOrder;
    const summaryEntries = Object.entries(summary || {});
    const countSelect = ['COUNT(*) AS total'].concat(summaryEntries.map(([key, sql]) => `${sql} AS \`${key}\``)).join(', ');

    const [countRows, rows] = await Promise.all([
        sequelize.query(`SELECT ${countSelect} FROM (${innerSql}) x ${whereSql}`,
            { replacements, type: sequelize.QueryTypes.SELECT }),
        sequelize.query(`SELECT x.* FROM (${innerSql}) x ${whereSql} ORDER BY ${order}${limit !== -1 ? ' LIMIT :gridLimit OFFSET :gridOffset' : ''}`,
            { replacements: { ...replacements, gridLimit: limit, gridOffset: offset }, type: sequelize.QueryTypes.SELECT })
    ]);
    const counts = countRows[0] || {};
    const summaryValues = {};
    summaryEntries.forEach(([key]) => { summaryValues[key] = Number(counts[key] || 0); });
    return { rows, total: Number(counts.total || 0), summary: summaryValues };
}

/**
 * Aggregate expressions counting each status value of `column` (statuses are code constants).
 * Pass `distinctId` when the joins repeat rows (counts DISTINCT ids instead of rows).
 */
function statusCountSql(column, statuses, distinctId) {
    const out = {};
    statuses.forEach(status => {
        const condition = `${column} = '${status.replace(/'/g, "''")}'`;
        out[`status_${status}`] = distinctId
            ? `COUNT(DISTINCT CASE WHEN ${condition} THEN ${distinctId} END)`
            : `SUM(CASE WHEN ${condition} THEN 1 ELSE 0 END)`;
    });
    return out;
}

/** Turns the flat `status_<value>` counts back into { value: count }. */
function statusCountsFrom(row, statuses) {
    const counts = {};
    statuses.forEach(status => { counts[status] = Number(row[`status_${status}`] || 0); });
    return counts;
}

module.exports = {
    parseGridFilters,
    applyGridFilters,
    selectAliases,
    resolveSort,
    orderSql,
    runOuterQuery,
    statusCountSql,
    statusCountsFrom,
    tatHoursSql
};
