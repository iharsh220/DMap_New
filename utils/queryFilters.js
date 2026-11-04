// Query-string filters/search fields are turned into WHERE clauses by several list
// endpoints. Keep only real columns of the target model so that unknown params
// (for example jQuery's `_=<timestamp>` cache-buster) no longer cause
// "Unknown column" 500 errors, and callers cannot override soft-delete scoping.
const PROTECTED_FIELDS = new Set(['is_deleted', 'password', 'latest_verification_token']);

const isFilterableField = (model, field) =>
    Object.prototype.hasOwnProperty.call(model.rawAttributes, field) && !PROTECTED_FIELDS.has(field);

const pickModelFilters = (model, filters = {}) => {
    const picked = {};
    for (const [key, value] of Object.entries(filters)) {
        if (isFilterableField(model, key)) {
            picked[key] = value;
        }
    }
    return picked;
};

const pickModelFields = (model, fields = []) => fields.filter(field => isFilterableField(model, field));

module.exports = { pickModelFilters, pickModelFields };
