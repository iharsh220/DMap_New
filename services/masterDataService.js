// Master data (admin panel "Master data" page): departments, divisions, designations, job roles,
// request types, project types, task types and change types, with the link tables that tie them
// together. Everything is driven by the REGISTRY below (fields, links, usages, scope), so the
// list / detail / create / update / delete code is generic. All SQL identifiers come from the
// registry; every value is a bound :replacement.
//
// Rules (owner, 2026-11-05):
// - Super Admin may change everything. Managers (roles 2, 3) only see and change the data of their
//   own department: its divisions, job roles and designations, and the request / project / task /
//   change types that hang off its divisions (request type -> division, project type -> request
//   type, task type -> project type, change type -> task type).
// - Links that the apps depend on are mandatory and kept in sync in one transaction:
//   a request type needs >= 1 division, a project type >= 1 request type, a task type >= 1 project
//   type, a change type >= 1 task type, and a designation >= 1 department + job role
//   (designation_departments and designation_jobroles are written together; registration takes
//   the job role from designation_jobroles).
// - Delete only when nothing uses the row (several FKs are ON DELETE CASCADE: deleting a request or
//   task type would otherwise delete its work requests / tasks). Rows with a `state` column can be
//   set inactive instead.
const { sequelize } = require('../config/databaseConfig');

const SELECT = (sql, replacements, transaction) =>
    sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT, transaction });
const RUN = (sql, replacements, transaction) =>
    sequelize.query(sql, { replacements, transaction });

const ADMIN_ROLE = 1;
const MANAGER_ROLES = [2, 3];
const EDITOR_ROLES = [ADMIN_ROLE, ...MANAGER_ROLES];

// Names the code looks up by text (renaming or deleting them breaks features):
// department 'Digilabs' (weekly report, overview verticals, isDigilabsManager), 'Leadership'
// (registration lists all divisions), the five Digilabs verticals (registration exclusions,
// weekly report units).
const PROTECTED_NAMES = {
    department: ['Digilabs', 'Leadership'],
    division: ['Graphic', 'Video', 'Shoot', 'Content', 'Web Application']
};
// Job role ids used in role checks across the code (checkRole lists, roles table in CLAUDE.md).
const CODE_ROLE_IDS = Array.from({ length: 22 }, (_, i) => i + 1);

const STATE = { name: 'state', label: 'Status', type: 'select', options: ['active', 'inactive'], default: 'active' };
const text = (name, label, max, required = true) => ({ name, label, type: 'text', max, required });
const area = (name, label) => ({ name, label, type: 'textarea', max: 5000, required: false });

// links: many-to-many through a link table. self = this entity's column, other = target's column.
// scopeParent: the link that decides which department the row belongs to (manager scope). min: how
// many links the row must keep.
const REGISTRY = {
    department: {
        table: 'department', title: 'department_name', label: 'Departments', singular: 'Department', icon: 'building',
        fields: [text('department_name', 'Name', 100), area('description', 'Description'), STATE],
        links: [],
        usages: [
            { table: 'users', column: 'department_id', label: 'Users' },
            { table: 'division', column: 'department_id', label: 'Divisions' },
            { table: 'job_role', column: 'department_id', label: 'Job roles' },
            { table: 'designation_departments', column: 'department_id', label: 'Designations' }
        ],
        adminOnlyCreate: true,
        help: 'A department groups divisions, job roles and designations. After creating one, add its divisions, job roles and designations.'
    },
    division: {
        table: 'division', title: 'title', label: 'Divisions', singular: 'Division', icon: 'diagram-2',
        fields: [text('title', 'Name', 100), { name: 'department_id', label: 'Department', type: 'ref', ref: 'department', required: true, scopeParent: true }, area('description', 'Description'), STATE],
        uniqueWithin: 'department_id',
        links: [
            { key: 'request_types', label: 'Request types handled', target: 'request_type', table: 'request_division_reference', self: 'division_id', other: 'request_id' }
        ],
        usages: [
            { table: 'user_divisions', column: 'division_id', label: 'Users (members)' },
            { table: 'master_card', column: 'division_id', label: 'Rate card rows' },
            { table: 'activity', column: 'division_id', label: 'Activities' },
            { table: 'doctors', column: 'division_id', label: 'Doctors' },
            { table: 'sales', column: 'division_id', label: 'Sales rows' },
            { table: 'work_medium', column: 'division_id', label: 'Work mediums' },
            { table: 'weekly_report_states', column: 'division_id', label: 'Weekly report' }
        ],
        help: 'A division belongs to one department. Request types linked here are handled by this division\'s managers.'
    },
    designation: {
        table: 'designation', title: 'designation_name', label: 'Designations', singular: 'Designation', icon: 'person-vcard',
        fields: [text('designation_name', 'Name', 100), text('designation_category', 'Category', 50), STATE],
        links: [],
        // designation -> (department, job role) pairs: designation_jobroles, mirrored in designation_departments
        mapping: { key: 'roles', label: 'Departments & job roles', table: 'designation_jobroles', mirror: 'designation_departments', min: 1 },
        usages: [{ table: 'users', column: 'designation_id', label: 'Users' }],
        help: 'At registration a user picks department + designation; the job role comes from this mapping, so every department needs a job role.'
    },
    job_role: {
        table: 'job_role', title: 'role_title', label: 'Job roles', singular: 'Job role', icon: 'shield-check',
        fields: [text('role_title', 'Name', 100), { name: 'level', label: 'Level', type: 'text', max: 50, required: false }, area('description', 'Description'), { name: 'department_id', label: 'Department', type: 'ref', ref: 'department', required: true, scopeParent: true }, STATE],
        uniqueWithin: 'department_id',
        links: [],
        usages: [
            { table: 'users', column: 'job_role_id', label: 'Users' },
            { table: 'designation_jobroles', column: 'jobrole_id', label: 'Designation mappings' }
        ],
        help: 'Access rules use the job role id (e.g. 1 Super Admin, 2 Creative Manager). A new role starts with no special rights.'
    },
    request_type: {
        table: 'request_type', title: 'request_type', label: 'Request types', singular: 'Request type', icon: 'inbox',
        fields: [text('request_type', 'Name', 100), area('description', 'Description')],
        links: [
            { key: 'divisions', label: 'Handled by divisions', target: 'division', table: 'request_division_reference', self: 'request_id', other: 'division_id', scopeParent: true, min: 1 },
            { key: 'project_types', label: 'Project types', target: 'project_type', table: 'project_request_reference', self: 'request_id', other: 'project_id' }
        ],
        usages: [
            { table: 'work_requests', column: 'request_type_id', label: 'Work requests' },
            { table: 'tasks', column: 'request_type_id', label: 'Tasks' }
        ],
        help: 'Requests of this type go to the managers of the linked divisions; the requester then picks one of its project types.'
    },
    project_type: {
        table: 'project_type', title: 'project_type', label: 'Project types', singular: 'Project type', icon: 'kanban',
        fields: [text('project_type', 'Name', 100), area('description', 'Description'), { name: 'quantification', label: 'Quantification', type: 'text', max: 100, required: false }],
        links: [
            { key: 'request_types', label: 'Request types', target: 'request_type', table: 'project_request_reference', self: 'project_id', other: 'request_id', scopeParent: true, min: 1 },
            { key: 'task_types', label: 'Task types', target: 'task_type', table: 'task_project_reference', self: 'project_id', other: 'task_id' }
        ],
        usages: [{ table: 'work_requests', column: 'project_id', label: 'Work requests' }]
    },
    task_type: {
        table: 'task_type', title: 'task_type', label: 'Task types', singular: 'Task type', icon: 'list-check',
        fields: [text('task_type', 'Name', 100), area('description', 'Description'), { name: 'quantification', label: 'Quantification', type: 'text', max: 100, required: false }],
        links: [
            { key: 'project_types', label: 'Project types', target: 'project_type', table: 'task_project_reference', self: 'task_id', other: 'project_id', scopeParent: true, min: 1 },
            { key: 'change_types', label: 'Change types', target: 'change_type', table: 'change_issue_tasktype', self: 'task_id', other: 'change_issue_id' }
        ],
        usages: [
            { table: 'tasks', column: 'task_type_id', label: 'Tasks' },
            { table: 'master_card', column: 'task_type_id', label: 'Rate card rows' }
        ]
    },
    change_type: {
        table: 'issue_register', title: 'change_issue_type', label: 'Change types', singular: 'Change type', icon: 'arrow-repeat',
        fields: [text('change_issue_type', 'Name', 100), area('description', 'Description'), { name: 'quantification', label: 'Quantification', type: 'text', max: 100, required: false }],
        links: [
            { key: 'task_types', label: 'Task types', target: 'task_type', table: 'change_issue_tasktype', self: 'change_issue_id', other: 'task_id', scopeParent: true, min: 1 }
        ],
        usages: [{ table: 'issue_assignment_types', column: 'issue_register_id', label: 'Change requests' }]
    }
};
const ORDER = ['department', 'division', 'designation', 'job_role', 'request_type', 'project_type', 'task_type', 'change_type'];

const entityOf = key => (Object.prototype.hasOwnProperty.call(REGISTRY, key) ? REGISTRY[key] : null);
const httpError = (status, message, extra) => Object.assign(new Error(message), { status, extra });

// ------------------------------------------------------------------
// scope
// ------------------------------------------------------------------
// Who may use the page and on which rows. Checked against the DB (role and department), not the token.
const resolveScope = async (tokenUser) => {
    const uid = Number(tokenUser && tokenUser.id);
    if (!Number.isInteger(uid) || uid <= 0) throw httpError(401, 'Not signed in');
    const [u] = await SELECT('SELECT id, job_role_id, department_id, account_status FROM users WHERE id = :uid', { uid });
    if (!u || u.account_status !== 'active' || !EDITOR_ROLES.includes(Number(u.job_role_id))) {
        throw httpError(403, 'Only Super Admin and managers can manage master data');
    }
    if (Number(u.job_role_id) === ADMIN_ROLE) return { all: true, userId: uid, roleId: ADMIN_ROLE, departments: [] };
    return { all: false, userId: uid, roleId: Number(u.job_role_id), departments: u.department_id ? [Number(u.department_id)] : [] };
};

// SQL condition "row `alias` of entity `key` is in the manager's scope" (null = no restriction).
// Built from the registry: department by id; an entity with a scopeParent ref field through that
// field; an entity with a scopeParent link through the link table; designation through its mapping.
const scopeSql = (key, alias, scope, depth = 0) => {
    if (scope.all) return null;
    if (depth > 8) throw new Error('scope recursion');
    if (!scope.departments.length) return '1 = 0';
    if (key === 'department') return `${alias}.id IN (:scopeDepartments)`;
    const e = REGISTRY[key];
    const refField = e.fields.find(f => f.type === 'ref' && f.scopeParent);
    if (refField) {
        if (refField.ref === 'department') return `${alias}.${refField.name} IN (:scopeDepartments)`;
        const t = REGISTRY[refField.ref];
        const a = `s${depth}`;
        return `${alias}.${refField.name} IN (SELECT ${a}.id FROM ${t.table} ${a} WHERE ${scopeSql(refField.ref, a, scope, depth + 1)})`;
    }
    if (e.mapping) return `${alias}.id IN (SELECT designation_id FROM ${e.mapping.mirror} WHERE department_id IN (:scopeDepartments))`;
    const link = e.links.find(l => l.scopeParent);
    if (link) {
        const t = REGISTRY[link.target];
        const a = `s${depth}`;
        return `${alias}.id IN (SELECT l${depth}.${link.self} FROM ${link.table} l${depth} JOIN ${t.table} ${a} ON ${a}.id = l${depth}.${link.other} WHERE ${scopeSql(link.target, a, scope, depth + 1)})`;
    }
    return '1 = 0';
};
const scopeReplacements = scope => ({ scopeDepartments: scope.departments.length ? scope.departments : [0] });

// ids of `key` in scope (all ids for Super Admin)
const scopedIds = async (key, scope, transaction) => {
    const e = REGISTRY[key];
    const cond = scopeSql(key, 'x', scope);
    const rows = await SELECT(`SELECT x.id FROM ${e.table} x${cond ? ' WHERE ' + cond : ''}`, scopeReplacements(scope), transaction);
    return new Set(rows.map(r => Number(r.id)));
};

// ------------------------------------------------------------------
// meta
// ------------------------------------------------------------------
const canCreate = (key, scope) => scope.all || !REGISTRY[key].adminOnlyCreate;

const meta = async (scope) => {
    const departments = scope.all ? [] : await SELECT('SELECT id, department_name AS name FROM department WHERE id IN (:scopeDepartments)', scopeReplacements(scope));
    const counts = {};
    for (const key of ORDER) counts[key] = (await scopedIds(key, scope)).size;
    return {
        scope: { all: scope.all, departments },
        entities: ORDER.map(key => {
            const e = REGISTRY[key];
            return {
                key, label: e.label, singular: e.singular, icon: e.icon, help: e.help || null, count: counts[key],
                canCreate: canCreate(key, scope),
                hasState: e.fields.some(f => f.name === 'state'),
                fields: e.fields.map(f => ({ name: f.name, label: f.label, type: f.type, ref: f.ref || null, required: !!f.required, max: f.max || null, options: f.options || null, default: f.default || null, scopeParent: !!f.scopeParent })),
                links: e.links.map(l => ({ key: l.key, label: l.label, target: l.target, scopeParent: !!l.scopeParent, min: l.min || 0 })),
                mapping: e.mapping ? { key: e.mapping.key, label: e.mapping.label, min: e.mapping.min } : null,
                usages: e.usages.map(u => u.label)
            };
        })
    };
};

// ------------------------------------------------------------------
// read
// ------------------------------------------------------------------
const loadRows = async (key, scope, { ids = null } = {}) => {
    const e = REGISTRY[key];
    const where = [];
    const repl = scopeReplacements(scope);
    const cond = scopeSql(key, 'x', scope);
    if (cond) where.push(cond);
    if (ids) { where.push('x.id IN (:ids)'); repl.ids = ids.length ? ids : [0]; }
    const refJoins = e.fields.filter(f => f.type === 'ref').map((f, i) => {
        const t = REGISTRY[f.ref];
        return { f, sql: `LEFT JOIN ${t.table} r${i} ON r${i}.id = x.${f.name}`, col: `r${i}.${t.title} AS ${f.name}__label` };
    });
    const rows = await SELECT(
        `SELECT x.id, ${e.fields.map(f => `x.${f.name}`).join(', ')}, x.created_at, x.updated_at
            ${refJoins.map(j => ', ' + j.col).join('')}
         FROM ${e.table} x ${refJoins.map(j => j.sql).join(' ')}
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY x.${e.title}, x.id`, repl);
    if (!rows.length) return [];
    const rowIds = rows.map(r => r.id);
    const byId = new Map(rows.map(r => {
        const out = { id: r.id, label: r[e.title], created_at: r.created_at, updated_at: r.updated_at, links: {}, usage: { total: 0, parts: [] } };
        e.fields.forEach(f => {
            out[f.name] = r[f.name];
            if (f.type === 'ref') out[f.name + '__label'] = r[f.name + '__label'] || null;
        });
        return [r.id, out];
    }));

    // links (one query per link; target rows flagged with inScope for managers)
    for (const l of e.links) {
        const t = REGISTRY[l.target];
        const linked = await SELECT(
            `SELECT l.${l.self} AS sid, t.id, t.${t.title} AS label FROM ${l.table} l JOIN ${t.table} t ON t.id = l.${l.other}
             WHERE l.${l.self} IN (:rowIds) ORDER BY t.${t.title}`, { rowIds });
        const inScope = scope.all ? null : await scopedIds(l.target, scope);
        byId.forEach(row => { row.links[l.key] = []; });
        const seen = new Set();
        linked.forEach(x => {
            const k = x.sid + ':' + x.id;
            if (seen.has(k)) return;
            seen.add(k);
            byId.get(x.sid).links[l.key].push({ id: x.id, label: x.label, inScope: inScope ? inScope.has(Number(x.id)) : true });
        });
    }
    if (e.mapping) {
        const m = await SELECT(
            `SELECT dj.designation_id AS sid, dj.department_id, d.department_name AS department, dj.jobrole_id, j.role_title AS jobrole
             FROM designation_jobroles dj JOIN department d ON d.id = dj.department_id JOIN job_role j ON j.id = dj.jobrole_id
             WHERE dj.designation_id IN (:rowIds) ORDER BY d.department_name, j.role_title`, { rowIds });
        byId.forEach(row => { row.mapping = []; });
        m.forEach(x => byId.get(x.sid).mapping.push({
            department_id: x.department_id, department: x.department, jobrole_id: x.jobrole_id, jobrole: x.jobrole,
            inScope: scope.all || scope.departments.includes(Number(x.department_id))
        }));
    }
    // usage counts (rows that block a delete)
    for (const u of e.usages) {
        const counts = await SELECT(`SELECT ${u.column} AS id, COUNT(*) AS n FROM ${u.table} WHERE ${u.column} IN (:rowIds) GROUP BY ${u.column}`, { rowIds });
        const map = new Map(counts.map(c => [Number(c.id), Number(c.n)]));
        byId.forEach((row, id) => {
            const n = map.get(Number(id)) || 0;
            row.usage.parts.push({ label: u.label, count: n });
            row.usage.total += n;
        });
    }
    // Managers see only their own department's side of a link; other departments' rows are
    // counted (linksHidden / mappingHidden) but not named. They are kept as they are on save.
    if (!scope.all) {
        byId.forEach(row => {
            row.linksHidden = {};
            Object.keys(row.links).forEach(k => {
                row.linksHidden[k] = row.links[k].filter(x => !x.inScope).length;
                row.links[k] = row.links[k].filter(x => x.inScope);
            });
            if (row.mapping) {
                row.mappingHidden = row.mapping.filter(m => !m.inScope).length;
                row.mapping = row.mapping.filter(m => m.inScope);
            }
        });
    }
    byId.forEach(row => {
        row.protected = protectedReason(key, row);
        row.canDelete = !row.protected && row.usage.total === 0 && (scope.all || canCreate(key, scope));
        row.canEdit = scope.all || !(key === 'job_role' && row.id === ADMIN_ROLE);
    });
    return rows.map(r => byId.get(r.id));
};

const protectedReason = (key, row) => {
    const names = PROTECTED_NAMES[key];
    if (names && names.some(n => n.toLowerCase() === String(row.label || '').trim().toLowerCase())) {
        return `"${row.label}" is used by name in the code (reports, registration), so it cannot be renamed or deleted.`;
    }
    if (key === 'job_role' && CODE_ROLE_IDS.includes(Number(row.id))) {
        return 'This job role id is used in the access rules, so it cannot be deleted.';
    }
    return null;
};

const list = async (key, scope, query = {}) => {
    const e = entityOf(key);
    if (!e) throw httpError(404, 'Unknown table');
    // lite: id + label for pickers. `all=1` lists every row (names only), used to link an existing
    // child type (e.g. a task type another department already created) instead of a duplicate.
    if (query.lite) {
        const all = query.all === '1' || query.all === 'true' || scope.all;
        const cond = all ? null : scopeSql(key, 'x', scope);
        const extra = e.fields.filter(f => f.type === 'ref').map(f => `, x.${f.name}`).join('');
        return SELECT(`SELECT x.id, x.${e.title} AS label${extra}${e.fields.some(f => f.name === 'state') ? ', x.state' : ''} FROM ${e.table} x${cond ? ' WHERE ' + cond : ''} ORDER BY x.${e.title}, x.id`, scopeReplacements(scope));
    }
    return loadRows(key, scope);
};

// One row with everything linked to it: its own links, rows of other tables that point at it
// (e.g. a department's divisions and job roles), designation mappings and usage counts.
const detail = async (key, id, scope) => {
    const e = entityOf(key);
    if (!e) throw httpError(404, 'Unknown table');
    const [row] = await loadRows(key, scope, { ids: [id] });
    if (!row) throw httpError(404, `${e.singular} not found or not in your department`);
    const sections = [];
    for (const l of e.links) {
        sections.push({ title: l.label, entity: l.target, link: l.key, hidden: (row.linksHidden || {})[l.key] || 0, rows: row.links[l.key].map(x => ({ id: x.id, label: x.label })) });
    }
    if (e.mapping) {
        sections.push({ title: e.mapping.label, entity: 'department', mapping: true, hidden: row.mappingHidden || 0, rows: row.mapping.map(m => ({ id: m.department_id, label: m.department, sub: m.jobrole, subEntity: 'job_role', subId: m.jobrole_id })) });
    }
    // other tables pointing at this row through a ref field (department -> divisions, job roles)
    for (const otherKey of ORDER) {
        const o = REGISTRY[otherKey];
        for (const f of o.fields.filter(x => x.type === 'ref' && x.ref === key)) {
            const cond = scopeSql(otherKey, 'x', scope);
            const rows = await SELECT(`SELECT x.id, x.${o.title} AS label FROM ${o.table} x WHERE x.${f.name} = :id${cond ? ' AND ' + cond : ''} ORDER BY x.${o.title}`, Object.assign({ id }, scopeReplacements(scope)));
            sections.push({ title: `${o.label} in this ${e.singular.toLowerCase()}`, entity: otherKey, rows, add: { entity: otherKey, preset: { [f.name]: id } } });
        }
    }
    // reverse designation mapping (department / job role -> designations)
    if (key === 'department' || key === 'job_role') {
        const col = key === 'department' ? 'department_id' : 'jobrole_id';
        const rows = await SELECT(
            `SELECT DISTINCT g.id, g.designation_name AS label, ${key === 'department' ? 'j.role_title' : 'd.department_name'} AS sub
             FROM designation_jobroles dj JOIN designation g ON g.id = dj.designation_id JOIN job_role j ON j.id = dj.jobrole_id JOIN department d ON d.id = dj.department_id
             WHERE dj.${col} = :id ORDER BY g.designation_name`, { id });
        sections.push({ title: key === 'department' ? 'Designations (with job role)' : 'Designations mapped to this role', entity: 'designation', rows });
    }
    return { row, sections };
};

// ------------------------------------------------------------------
// write
// ------------------------------------------------------------------
const toId = v => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
};
const idList = (v, label) => {
    if (v === undefined) return undefined;
    const arr = Array.isArray(v) ? v : (v === null || v === '' ? [] : [v]);
    const out = [];
    for (const x of arr) {
        const n = toId(typeof x === 'object' && x !== null ? x.id : x);
        if (!n) throw httpError(400, `Invalid id in ${label}`);
        if (!out.includes(n)) out.push(n);
    }
    return out;
};

// Validates and normalizes the plain fields. `current` is the existing row on update.
const cleanFields = async (key, body, scope, current, transaction) => {
    const e = REGISTRY[key];
    const out = {};
    for (const f of e.fields) {
        const has = Object.prototype.hasOwnProperty.call(body, f.name);
        if (!has && current) continue;
        let v = has ? body[f.name] : (f.default !== undefined ? f.default : null);
        if (f.type === 'ref') {
            v = v === '' || v === null || v === undefined ? null : toId(v);
            if (v === null && has && body[f.name] !== '' && body[f.name] !== null) throw httpError(400, `${f.label} is invalid`);
            if (v === null) {
                if (f.required) throw httpError(400, `${f.label} is required`);
            } else {
                const t = REGISTRY[f.ref];
                const [exists] = await SELECT(`SELECT id FROM ${t.table} WHERE id = :v`, { v }, transaction);
                if (!exists) throw httpError(400, `${f.label} not found`);
                if (f.scopeParent && !scope.all && !(await scopedIds(f.ref, scope, transaction)).has(v)) {
                    throw httpError(403, `You can only use your own ${t.singular.toLowerCase()}`);
                }
            }
        } else if (f.type === 'select') {
            v = v === null || v === undefined || v === '' ? f.default : String(v);
            if (!f.options.includes(v)) throw httpError(400, `${f.label} must be one of ${f.options.join(', ')}`);
        } else {
            v = v === null || v === undefined ? '' : String(v).trim();
            if (!v) {
                if (f.required) throw httpError(400, `${f.label} is required`);
                v = null;
            } else if (f.max && v.length > f.max) {
                throw httpError(400, `${f.label} can be at most ${f.max} characters`);
            }
        }
        out[f.name] = v;
    }
    return out;
};

const assertUniqueName = async (key, values, id, transaction) => {
    const e = REGISTRY[key];
    const name = values[e.title];
    if (name === undefined) return;
    const repl = { name, id: id || 0 };
    let within = '';
    if (e.uniqueWithin) { within = ` AND ${e.uniqueWithin} <=> :within`; repl.within = values[e.uniqueWithin]; }
    const [dupe] = await SELECT(`SELECT id FROM ${e.table} WHERE LOWER(TRIM(${e.title})) = LOWER(:name) AND id <> :id${within} LIMIT 1`, repl, transaction);
    if (dupe) throw httpError(409, `A ${e.singular.toLowerCase()} named "${name}" already exists${e.uniqueWithin ? ' there' : ''} (id ${dupe.id})`);
};

// New link set for one link. Managers may only add/remove targets in their scope on the link that
// decides the scope; links to other departments' rows are kept as they are.
const resolveLinkSet = async (key, l, submitted, existing, scope, transaction) => {
    const t = REGISTRY[l.target];
    if (submitted.length) {
        const found = await SELECT(`SELECT id FROM ${t.table} WHERE id IN (:ids)`, { ids: submitted }, transaction);
        if (found.length !== submitted.length) throw httpError(400, `Some ${t.label.toLowerCase()} were not found`);
    }
    if (scope.all || !l.scopeParent) {
        if (l.min && submitted.length < l.min) throw httpError(400, `Pick at least ${l.min} ${l.min === 1 ? t.singular.toLowerCase() : t.label.toLowerCase()} (${l.label})`);
        return submitted;
    }
    const inScope = await scopedIds(l.target, scope, transaction);
    const outside = submitted.filter(x => !inScope.has(x));
    if (outside.length) throw httpError(403, `You can only link ${t.label.toLowerCase()} of your own department`);
    if (l.min && submitted.length < l.min) throw httpError(400, `Pick at least ${l.min} ${t.singular.toLowerCase()} of your department (${l.label})`);
    const kept = existing.filter(x => !inScope.has(x));
    return [...new Set([...kept, ...submitted])];
};

const resolveMapping = async (submitted, existing, scope, transaction) => {
    if (!Array.isArray(submitted)) throw httpError(400, 'Departments & job roles must be a list');
    const pairs = [];
    for (const p of submitted) {
        const department_id = toId(p && p.department_id);
        const jobrole_id = toId(p && p.jobrole_id);
        if (!department_id) throw httpError(400, 'Each row needs a department');
        if (!jobrole_id) throw httpError(400, 'Each department needs a job role (registration takes the role from it)');
        if (pairs.some(x => x.department_id === department_id)) throw httpError(400, 'A department can be added only once');
        if (!scope.all && !scope.departments.includes(department_id)) throw httpError(403, 'You can only map your own department');
        const [role] = await SELECT('SELECT id, department_id FROM job_role WHERE id = :jobrole_id', { jobrole_id }, transaction);
        const [dept] = await SELECT('SELECT id FROM department WHERE id = :department_id', { department_id }, transaction);
        if (!dept) throw httpError(400, 'Department not found');
        if (!role) throw httpError(400, 'Job role not found');
        if (role.department_id !== null && Number(role.department_id) !== department_id) throw httpError(400, 'The job role must belong to the same department');
        pairs.push({ department_id, jobrole_id });
    }
    const kept = scope.all ? [] : existing.filter(x => !scope.departments.includes(Number(x.department_id)));
    const all = [...kept.map(x => ({ department_id: Number(x.department_id), jobrole_id: Number(x.jobrole_id) })), ...pairs];
    if (!all.length || (!scope.all && !pairs.length)) throw httpError(400, 'Add at least one department with its job role');
    return all;
};

const writeLinks = async (key, id, body, scope, transaction, isNew) => {
    const e = REGISTRY[key];
    const links = body.links || {};
    for (const l of e.links) {
        let submitted = idList(links[l.key], l.label);
        if (submitted === undefined) {
            if (isNew && l.min) throw httpError(400, `${l.label}: pick at least ${l.min}`);
            continue;
        }
        const existing = isNew ? [] : (await SELECT(`SELECT ${l.other} AS id FROM ${l.table} WHERE ${l.self} = :id`, { id }, transaction)).map(r => Number(r.id));
        const next = await resolveLinkSet(key, l, submitted, existing, scope, transaction);
        const add = next.filter(x => !existing.includes(x));
        const remove = existing.filter(x => !next.includes(x));
        if (remove.length) await RUN(`DELETE FROM ${l.table} WHERE ${l.self} = :id AND ${l.other} IN (:remove)`, { id, remove }, transaction);
        for (const x of add) await RUN(`INSERT INTO ${l.table} (${l.self}, ${l.other}, created_at, updated_at) VALUES (:id, :x, NOW(), NOW())`, { id, x }, transaction);
    }
    if (e.mapping) {
        const submitted = body.mapping;
        if (submitted === undefined) {
            if (isNew) throw httpError(400, 'Add at least one department with its job role');
            return;
        }
        const existing = isNew ? [] : await SELECT('SELECT department_id, jobrole_id FROM designation_jobroles WHERE designation_id = :id', { id }, transaction);
        const pairs = await resolveMapping(submitted, existing, scope, transaction);
        await RUN('DELETE FROM designation_jobroles WHERE designation_id = :id', { id }, transaction);
        await RUN('DELETE FROM designation_departments WHERE designation_id = :id', { id }, transaction);
        for (const p of pairs) {
            await RUN('INSERT INTO designation_jobroles (designation_id, jobrole_id, department_id, created_at, updated_at) VALUES (:id, :jobrole_id, :department_id, NOW(), NOW())', Object.assign({ id }, p), transaction);
            await RUN('INSERT INTO designation_departments (designation_id, department_id, created_at, updated_at) VALUES (:id, :department_id, NOW(), NOW())', Object.assign({ id }, p), transaction);
        }
    }
};

const create = async (key, body, scope) => {
    const e = entityOf(key);
    if (!e) throw httpError(404, 'Unknown table');
    if (!canCreate(key, scope)) throw httpError(403, `Only Super Admin can create a ${e.singular.toLowerCase()}`);
    return sequelize.transaction(async (transaction) => {
        const values = await cleanFields(key, body || {}, scope, null, transaction);
        await assertUniqueName(key, values, 0, transaction);
        const cols = Object.keys(values);
        const [insertId] = await sequelize.query(
            `INSERT INTO ${e.table} (${cols.join(', ')}, created_at, updated_at) VALUES (${cols.map(c => ':' + c).join(', ')}, NOW(), NOW())`,
            { replacements: values, type: sequelize.QueryTypes.INSERT, transaction });
        const id = Number(insertId);
        await writeLinks(key, id, body || {}, scope, transaction, true);
        return id;
    });
};

const update = async (key, id, body, scope) => {
    const e = entityOf(key);
    if (!e) throw httpError(404, 'Unknown table');
    return sequelize.transaction(async (transaction) => {
        const cond = scopeSql(key, 'x', scope);
        const [current] = await SELECT(`SELECT x.* FROM ${e.table} x WHERE x.id = :id${cond ? ' AND ' + cond : ''} FOR UPDATE`, Object.assign({ id }, scopeReplacements(scope)), transaction);
        if (!current) throw httpError(404, `${e.singular} not found or not in your department`);
        if (!scope.all && key === 'job_role' && Number(id) === ADMIN_ROLE) throw httpError(403, 'Only Super Admin can change this job role');
        const values = await cleanFields(key, body || {}, scope, current, transaction);
        const reason = protectedReason(key, { id, label: current[e.title] });
        if (reason && key !== 'job_role' && values[e.title] !== undefined && values[e.title] !== current[e.title]) throw httpError(409, reason);
        if (values[e.title] !== undefined || (e.uniqueWithin && values[e.uniqueWithin] !== undefined)) {
            const merged = { [e.title]: current[e.title] };
            if (e.uniqueWithin) merged[e.uniqueWithin] = current[e.uniqueWithin];
            await assertUniqueName(key, Object.assign(merged, values), id, transaction);
        }
        const cols = Object.keys(values);
        if (cols.length) {
            await RUN(`UPDATE ${e.table} SET ${cols.map(c => `${c} = :${c}`).join(', ')}, updated_at = NOW() WHERE id = :id`, Object.assign({}, values, { id }), transaction);
        }
        await writeLinks(key, id, body || {}, scope, transaction, false);
        // a manager must not move a row out of their own department by editing it
        if (!scope.all && !(await scopedIds(key, scope, transaction)).has(Number(id))) {
            throw httpError(403, 'After this change the row would no longer belong to your department');
        }
        return id;
    });
};

// Rows whose mandatory link would be left empty if `id` of `key` were deleted
// (e.g. a request type whose only division is this one).
const orphanedByDelete = async (key, id, transaction) => {
    const problems = [];
    for (const otherKey of ORDER) {
        for (const l of REGISTRY[otherKey].links.filter(x => x.target === key && x.min)) {
            const t = REGISTRY[otherKey];
            const rows = await SELECT(
                `SELECT o.id, o.${t.title} AS label FROM ${t.table} o
                 WHERE o.id IN (SELECT ${l.self} FROM ${l.table} WHERE ${l.other} = :id)
                   AND (SELECT COUNT(*) FROM ${l.table} z WHERE z.${l.self} = o.id) <= 1`, { id }, transaction);
            rows.forEach(r => problems.push(`${t.singular} "${r.label}" would have no ${REGISTRY[key].singular.toLowerCase()} left`));
        }
    }
    return problems;
};

const remove = async (key, id, scope) => {
    const e = entityOf(key);
    if (!e) throw httpError(404, 'Unknown table');
    if (!canCreate(key, scope)) throw httpError(403, `Only Super Admin can delete a ${e.singular.toLowerCase()}`);
    return sequelize.transaction(async (transaction) => {
        const [row] = await loadRows(key, scope, { ids: [id] });
        if (!row) throw httpError(404, `${e.singular} not found or not in your department`);
        if (row.protected) throw httpError(409, row.protected);
        if (row.usage.total > 0) {
            const used = row.usage.parts.filter(p => p.count).map(p => `${p.count} ${p.label.toLowerCase()}`).join(', ');
            throw httpError(409, `Cannot delete: still used by ${used}.${e.fields.some(f => f.name === 'state') ? ' Set it to inactive instead.' : ''}`);
        }
        if (!scope.all) {
            // a manager may not delete a row that other departments still link to
            const outside = Object.values(row.linksHidden || {}).reduce((a, b) => a + b, 0) + (row.mappingHidden || 0);
            if (outside) throw httpError(409, 'Cannot delete: other departments still use it');
        }
        const orphans = await orphanedByDelete(key, id, transaction);
        if (orphans.length) throw httpError(409, 'Cannot delete: ' + orphans.slice(0, 5).join('; ') + (orphans.length > 5 ? ` (+${orphans.length - 5} more)` : ''));
        for (const l of e.links) await RUN(`DELETE FROM ${l.table} WHERE ${l.self} = :id`, { id }, transaction);
        // links defined on the other side only (none today, kept generic)
        for (const otherKey of ORDER) {
            for (const l of REGISTRY[otherKey].links.filter(x => x.target === key && !e.links.some(m => m.table === x.table))) {
                await RUN(`DELETE FROM ${l.table} WHERE ${l.other} = :id`, { id }, transaction);
            }
        }
        if (e.mapping) {
            await RUN('DELETE FROM designation_jobroles WHERE designation_id = :id', { id }, transaction);
            await RUN('DELETE FROM designation_departments WHERE designation_id = :id', { id }, transaction);
        }
        await RUN(`DELETE FROM ${e.table} WHERE id = :id`, { id }, transaction);
        return { id, label: row.label };
    });
};

module.exports = { REGISTRY, ORDER, EDITOR_ROLES, resolveScope, meta, list, detail, create, update, remove, httpError };
