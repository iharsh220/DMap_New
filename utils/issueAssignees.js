// A change request (issue_assignments) raised by the PMT with an attachment stores that file
// under an issue_user_assignments row of the PMT (issue_documents.issue_user_assignment_id is
// NOT NULL), until a manager assigns the change: assignIssueToUser then moves that row to the
// artist. So before the assignment the PMT showed up as the change's assignee in every API
// ("assignedUsers[0] = PMT"), and the apps pre-selected the PMT in the manager's assign list.
//
// The PMT / requester is never the assignee of a change (only a creative user is, see
// assignIssueToUser). hideRequesterAssignees(payload) walks a JSON payload and, on every change
// object (one that has `requested_by_user_id` or a `requester` object), removes from its
// `userAssignments` / `assignedUsers` / `user_assignments` arrays the rows of the change's own
// requester, and keeps their files in `pmt_documents` (added when missing; each file still has
// uploaded_by = 'pmt'). Everything else in the payload is left untouched.
const ASSIGNEE_KEYS = ['userAssignments', 'assignedUsers', 'user_assignments'];

const toPlain = (v) => (v && typeof v.toJSON === 'function' ? v.toJSON() : v);

const requesterIdOf = (o) => {
    if (o.requested_by_user_id !== undefined && o.requested_by_user_id !== null) return Number(o.requested_by_user_id);
    const r = o.requester;
    if (r && typeof r === 'object' && r.id !== undefined && r.id !== null) return Number(r.id);
    return null;
};

const rowUserId = (row) => {
    if (!row || typeof row !== 'object') return null;
    if (row.user_id !== undefined && row.user_id !== null) return Number(row.user_id);
    if (row.user && row.user.id !== undefined && row.user.id !== null) return Number(row.user.id);
    return null;
};

const clean = (node, seen) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return node;
    seen.add(node);
    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) node[i] = clean(toPlain(node[i]), seen);
        return node;
    }
    for (const k of Object.keys(node)) {
        const v = toPlain(node[k]);
        if (v && typeof v === 'object') node[k] = clean(v, seen);
    }
    const requesterId = requesterIdOf(node);
    if (requesterId) {
        for (const key of ASSIGNEE_KEYS) {
            const list = node[key];
            if (!Array.isArray(list) || !list.some(row => rowUserId(row) === requesterId)) continue;
            const removed = list.filter(row => rowUserId(row) === requesterId);
            node[key] = list.filter(row => rowUserId(row) !== requesterId);
            const docs = removed.flatMap(row => (Array.isArray(row.documents) ? row.documents : []));
            if (docs.length) {
                const existing = Array.isArray(node.pmt_documents) ? node.pmt_documents : [];
                const ids = new Set(existing.map(d => d && d.id));
                node.pmt_documents = existing.concat(docs.filter(d => !ids.has(d && d.id)));
            }
        }
    }
    return node;
};

const hideRequesterAssignees = (payload) => clean(toPlain(payload), new Set());

// Router middleware: applies hideRequesterAssignees to every JSON response of the router.
const hideRequesterAssigneesMiddleware = (req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body) => {
        try {
            return json(hideRequesterAssignees(body));
        } catch (err) {
            console.error('[hideRequesterAssignees]', err.message);
            return json(body);
        }
    };
    next();
};

module.exports = { hideRequesterAssignees, hideRequesterAssigneesMiddleware };
