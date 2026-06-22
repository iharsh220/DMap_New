const {
  WorkRequestHistory,
  TaskHistory,
  IssueHistory
} = require('../models');

const normalizeValue = (value) => {
  if (value && typeof value.toJSON === 'function') {
    return value.toJSON();
  }
  return value;
};

const safeJson = (value) => {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(normalizeValue(value)));
  } catch (error) {
    return null;
  }
};

const diffChanges = (previousData, nextData, fields = null) => {
  const previous = normalizeValue(previousData) || {};
  const next = normalizeValue(nextData) || {};
  const keys = fields && fields.length > 0
    ? fields
    : [...new Set([...Object.keys(previous), ...Object.keys(next)])];

  const changes = {};
  for (const key of keys) {
    const before = previous[key];
    const after = next[key];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changes[key] = { before: safeJson(before), after: safeJson(after) };
    }
  }
  return changes;
};

const inferActorType = (actor) => {
  const roleId = actor?.job_role_id || actor?.jobRole?.id || actor?.role_id;
  if (roleId === 1) return 'admin';
  if (roleId === 2 || roleId === 3) return 'manager';
  if (roleId === 4) return 'user';
  if (actor?.userType) return actor.userType;
  return 'user';
};

const buildActor = (req, actorOverride) => {
  const actor = actorOverride || req?.user || {};
  return {
    actor_id: actor.id || null,
    actor_type: actor.actor_type || inferActorType(actor),
    actor_name: actor.name || null,
    actor_email: actor.email || null
  };
};

const safeCreate = async (Model, payload) => {
  try {
    return await Model.create(payload);
  } catch (error) {
    console.error(`Error recording ${Model.tableName} history:`, error);
    return null;
  }
};

const recordWorkRequestHistory = async ({
  req,
  transaction,
  workRequestId,
  action,
  previousData = null,
  nextData = null,
  changes = null,
  comments = null,
  previousStatus = null,
  newStatus = null,
  previousReview = null,
  newReview = null,
  previousReviewStage = null,
  newReviewStage = null,
  relatedUserId = null,
  relatedUserName = null,
  relatedManagerId = null,
  relatedTaskId = null,
  relatedIssueId = null,
  actorOverride = null,
  fields = null
}) => {
  const actor = buildActor(req, actorOverride);
  const previous = safeJson(previousData);
  const next = safeJson(nextData);
  const payload = {
    ...actor,
    work_request_id: workRequestId,
    action,
    previous_status: previousStatus,
    new_status: newStatus,
    previous_review: previousReview,
    new_review: newReview,
    previous_review_stage: previousReviewStage,
    new_review_stage: newReviewStage,
    previous_data: previous,
    changes: changes || diffChanges(previous, next, fields),
    next_data: next,
    comments,
    related_user_id: relatedUserId,
    related_user_name: relatedUserName,
    related_manager_id: relatedManagerId,
    related_task_id: relatedTaskId,
    related_issue_id: relatedIssueId
  };

  return safeCreate(WorkRequestHistory, transaction ? { ...payload, transaction } : payload);
};

const recordTaskHistory = async ({
  req,
  transaction,
  taskId,
  workRequestId = null,
  action,
  previousData = null,
  nextData = null,
  changes = null,
  comments = null,
  previousStatus = null,
  newStatus = null,
  previousReview = null,
  newReview = null,
  previousReviewStage = null,
  newReviewStage = null,
  relatedUserId = null,
  relatedUserName = null,
  assignedToUserId = null,
  assignedToUserName = null,
  relatedIssueId = null,
  actorOverride = null,
  fields = null
}) => {
  const actor = buildActor(req, actorOverride);
  const previous = safeJson(previousData);
  const next = safeJson(nextData);
  const payload = {
    ...actor,
    task_id: taskId,
    work_request_id: workRequestId,
    action,
    previous_status: previousStatus,
    new_status: newStatus,
    previous_review: previousReview,
    new_review: newReview,
    previous_review_stage: previousReviewStage,
    new_review_stage: newReviewStage,
    previous_data: previous,
    changes: changes || diffChanges(previous, next, fields),
    next_data: next,
    comments,
    related_user_id: relatedUserId,
    related_user_name: relatedUserName,
    assigned_to_user_id: assignedToUserId,
    assigned_to_user_name: assignedToUserName,
    related_issue_id: relatedIssueId
  };

  return safeCreate(TaskHistory, transaction ? { ...payload, transaction } : payload);
};

const recordIssueHistory = async ({
  req,
  transaction,
  issueAssignmentId,
  taskId = null,
  workRequestId = null,
  parentIssueId = null,
  action,
  previousData = null,
  nextData = null,
  changes = null,
  comments = null,
  previousStatus = null,
  newStatus = null,
  previousReview = null,
  newReview = null,
  previousReviewStage = null,
  newReviewStage = null,
  relatedUserId = null,
  relatedUserName = null,
  assignedToUserId = null,
  assignedToUserName = null,
  relatedIssueId = null,
  actorOverride = null,
  fields = null
}) => {
  const actor = buildActor(req, actorOverride);
  const previous = safeJson(previousData);
  const next = safeJson(nextData);
  const payload = {
    ...actor,
    issue_assignment_id: issueAssignmentId,
    task_id: taskId,
    work_request_id: workRequestId,
    parent_issue_id: parentIssueId,
    action,
    previous_status: previousStatus,
    new_status: newStatus,
    previous_review: previousReview,
    new_review: newReview,
    previous_review_stage: previousReviewStage,
    new_review_stage: newReviewStage,
    previous_data: previous,
    changes: changes || diffChanges(previous, next, fields),
    next_data: next,
    comments,
    related_user_id: relatedUserId,
    related_user_name: relatedUserName,
    assigned_to_user_id: assignedToUserId,
    assigned_to_user_name: assignedToUserName,
    related_issue_id: relatedIssueId
  };

  return safeCreate(IssueHistory, transaction ? { ...payload, transaction } : payload);
};

const getWorkRequestHistory = async (workRequestId, { limit = 200, offset = 0 } = {}) => {
  return WorkRequestHistory.findAll({
    where: { work_request_id: workRequestId },
    order: [['created_at', 'DESC']],
    limit,
    offset
  });
};

const getTaskHistory = async (taskId, { limit = 200, offset = 0 } = {}) => {
  return TaskHistory.findAll({
    where: { task_id: taskId },
    order: [['created_at', 'DESC']],
    limit,
    offset
  });
};

const getIssueHistory = async (issueAssignmentId, { limit = 200, offset = 0 } = {}) => {
  return IssueHistory.findAll({
    where: { issue_assignment_id: issueAssignmentId },
    order: [['created_at', 'DESC']],
    limit,
    offset
  });
};

module.exports = {
  recordWorkRequestHistory,
  recordTaskHistory,
  recordIssueHistory,
  getWorkRequestHistory,
  getTaskHistory,
  getIssueHistory,
  diffChanges,
  safeJson
};
