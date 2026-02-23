const { sequelize } = require('../config/databaseConfig');

// Import models
const Department = require('./Department/Department');
const Division = require('./Division/Division');
const JobRole = require('./JobRole/JobRole');
const Designation = require('./Designation/Designation');
const DesignationDepartment = require('./DesignationDepartment/DesignationDepartment');
const DesignationJobRole = require('./DesignationJobRole/DesignationJobRole');
const Location = require('./Location/Location');
const User = require('./User/User');
const Sales = require('./Sales/Sales');
const Tasks = require('./Tasks/Tasks');
const UserDivisions = require('./UserDivisions/UserDivisions');
const RequestType = require('./RequestType/RequestType');
const RequestDivisionReference = require('./RequestDivisionReference/RequestDivisionReference');
const WorkRequests = require('./WorkRequests/WorkRequests');
const WorkRequestManagers = require('./WorkRequestManagers/WorkRequestManagers');
const WorkRequestDocuments = require('./WorkRequestDocuments/WorkRequestDocuments');
const ProjectType = require('./ProjectType/ProjectType');
const TaskType = require('./TaskType/TaskType');
const ProjectRequestReference = require('./ProjectRequestReference/ProjectRequestReference');
const IssueRegister = require('./IssueRegister/IssueRegister');
const TaskProjectReference = require('./TaskProjectReference/TaskProjectReference');
const TaskDependencies = require('./TaskDependencies/TaskDependencies');
const TaskAssignments = require('./TaskAssignments/TaskAssignments');
const TaskDocuments = require('./TaskDocuments/TaskDocuments');
const AboutProject = require('./AboutProject/AboutProject');
const IssueAssignments = require('./IssueAssignments/IssueAssignments');
const IssueUserAssignments = require('./IssueUserAssignments/IssueUserAssignments');
const IssueDocuments = require('./IssueDocuments/IssueDocuments');
const IssueAssignmentTypes = require('./IssueAssignmentTypes/IssueAssignmentTypes');
const ChangeIssueTasktype = require('./ChangeIssueTasktype/ChangeIssueTasktype');
const TaskReviewHistory = require('./TaskReviewHistory/TaskReviewHistory');

// Associations
Department.hasMany(Division, { foreignKey: 'department_id', as: 'divisions' });
Division.belongsTo(Department, { foreignKey: 'department_id', as: 'department' });

Department.hasMany(JobRole, { foreignKey: 'department_id' });
JobRole.belongsTo(Department, { foreignKey: 'department_id' });

Designation.belongsToMany(Department, { through: DesignationDepartment, foreignKey: 'designation_id' });
Department.belongsToMany(Designation, { through: DesignationDepartment, foreignKey: 'department_id' });

// Direct associations for junction tables
DesignationDepartment.belongsTo(Designation, { foreignKey: 'designation_id', as: 'designation' });
DesignationDepartment.belongsTo(Department, { foreignKey: 'department_id', as: 'department' });

Designation.belongsToMany(JobRole, { through: DesignationJobRole, foreignKey: 'designation_id' });
JobRole.belongsToMany(Designation, { through: DesignationJobRole, foreignKey: 'jobrole_id' });

// Direct associations for junction tables
DesignationJobRole.belongsTo(Designation, { foreignKey: 'designation_id', as: 'designation' });
DesignationJobRole.belongsTo(JobRole, { foreignKey: 'jobrole_id', as: 'jobRole' });

User.belongsTo(Department, { foreignKey: 'department_id' });
User.belongsTo(JobRole, { foreignKey: 'job_role_id' });
User.belongsTo(Location, { foreignKey: 'location_id' });
User.belongsTo(Designation, { foreignKey: 'designation_id' });

User.belongsToMany(Division, { through: UserDivisions, foreignKey: 'user_id', as: 'Divisions' });
Division.belongsToMany(User, { through: UserDivisions, foreignKey: 'division_id' });

UserDivisions.belongsTo(User, { foreignKey: 'user_id' });
UserDivisions.belongsTo(Division, { foreignKey: 'division_id', as: 'division' });

Sales.belongsTo(Division, { foreignKey: 'division_id' });

Tasks.belongsTo(TaskType, { foreignKey: 'task_type_id' });
Tasks.belongsTo(WorkRequests, { foreignKey: 'work_request_id' });
Tasks.belongsTo(RequestType, { foreignKey: 'request_type_id' });


WorkRequests.belongsTo(User, { foreignKey: 'user_id', as: 'users' });
WorkRequests.belongsTo(RequestType, { foreignKey: 'request_type_id' });
WorkRequests.belongsTo(ProjectType, { foreignKey: 'project_id' });
WorkRequests.hasMany(WorkRequestManagers, { foreignKey: 'work_request_id' });
WorkRequests.hasMany(WorkRequestDocuments, { foreignKey: 'work_request_id' });
WorkRequests.hasMany(Tasks, { foreignKey: 'work_request_id' });

WorkRequestManagers.belongsTo(WorkRequests, { foreignKey: 'work_request_id' });
WorkRequestManagers.belongsTo(User, { as: 'manager', foreignKey: 'manager_id' });

WorkRequestDocuments.belongsTo(WorkRequests, { foreignKey: 'work_request_id' });

RequestType.belongsToMany(Division, { through: RequestDivisionReference, foreignKey: 'request_id' });
Division.belongsToMany(RequestType, { through: RequestDivisionReference, foreignKey: 'division_id' });

RequestDivisionReference.belongsTo(RequestType, { foreignKey: 'request_id' });
RequestDivisionReference.belongsTo(Division, { foreignKey: 'division_id' });

ProjectType.belongsToMany(RequestType, { through: ProjectRequestReference, foreignKey: 'project_id' });
RequestType.belongsToMany(ProjectType, { through: ProjectRequestReference, foreignKey: 'request_id' });

ProjectRequestReference.belongsTo(ProjectType, { foreignKey: 'project_id', as: 'projectType' });
ProjectRequestReference.belongsTo(RequestType, { foreignKey: 'request_id', as: 'requestType' });

TaskType.belongsToMany(ProjectType, { through: TaskProjectReference, foreignKey: 'task_id' });
ProjectType.belongsToMany(TaskType, { through: TaskProjectReference, foreignKey: 'project_id' });

TaskProjectReference.belongsTo(TaskType, { foreignKey: 'task_id', as: 'taskType' });
TaskProjectReference.belongsTo(ProjectType, { foreignKey: 'project_id', as: 'projectType' });

TaskDependencies.belongsTo(Tasks, { foreignKey: 'task_id', as: 'task' });
TaskDependencies.belongsTo(Tasks, { foreignKey: 'dependency_task_id', as: 'dependencyTask' });
Tasks.hasMany(TaskDependencies, { foreignKey: 'task_id', as: 'dependencies' });
Tasks.hasMany(TaskDependencies, { foreignKey: 'dependency_task_id', as: 'dependentTasks' });

Tasks.belongsToMany(User, { through: TaskAssignments, foreignKey: 'task_id', as: 'assignedUsers' });
User.belongsToMany(Tasks, { through: TaskAssignments, foreignKey: 'user_id', as: 'assignedTasks' });
Tasks.hasMany(TaskAssignments, { foreignKey: 'task_id' });
TaskAssignments.belongsTo(Tasks, { foreignKey: 'task_id' });
TaskAssignments.belongsTo(User, { foreignKey: 'user_id' });

TaskDocuments.belongsTo(TaskAssignments, { foreignKey: 'task_assignment_id' });
TaskAssignments.hasMany(TaskDocuments, { foreignKey: 'task_assignment_id' });

// IssueAssignments Associations (similar to Tasks pattern)
IssueAssignments.belongsTo(Tasks, { foreignKey: 'task_id', as: 'task' });
IssueAssignments.belongsTo(User, { foreignKey: 'requested_by_user_id', as: 'requester' });

// IssueAssignments <-> IssueRegister many-to-many through IssueAssignmentTypes (for multiple issue types)
IssueAssignments.belongsToMany(IssueRegister, { through: IssueAssignmentTypes, foreignKey: 'issue_assignment_id', as: 'issueTypes' });
IssueRegister.belongsToMany(IssueAssignments, { through: IssueAssignmentTypes, foreignKey: 'issue_register_id', as: 'issueAssignments' });

// IssueAssignmentTypes direct associations
IssueAssignmentTypes.belongsTo(IssueAssignments, { foreignKey: 'issue_assignment_id', as: 'issueAssignment' });
IssueAssignmentTypes.belongsTo(IssueRegister, { foreignKey: 'issue_register_id', as: 'issueRegister' });
IssueAssignments.hasMany(IssueAssignmentTypes, { foreignKey: 'issue_assignment_id', as: 'issueTypeLinks' });
IssueRegister.hasMany(IssueAssignmentTypes, { foreignKey: 'issue_register_id', as: 'assignmentTypeLinks' });

// IssueAssignments <-> User many-to-many through IssueUserAssignments
IssueAssignments.belongsToMany(User, { through: IssueUserAssignments, foreignKey: 'issue_assignment_id', as: 'assignedUsers' });
User.belongsToMany(IssueAssignments, { through: IssueUserAssignments, foreignKey: 'user_id', as: 'issueAssignments' });

// IssueAssignments has many IssueUserAssignments
IssueAssignments.hasMany(IssueUserAssignments, { foreignKey: 'issue_assignment_id', as: 'userAssignments' });
IssueUserAssignments.belongsTo(IssueAssignments, { foreignKey: 'issue_assignment_id', as: 'issueAssignment' });

// IssueUserAssignments belongs to User
IssueUserAssignments.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(IssueUserAssignments, { foreignKey: 'user_id', as: 'issueUserAssignments' });

// IssueDocuments belongs to IssueUserAssignments
IssueDocuments.belongsTo(IssueUserAssignments, { foreignKey: 'issue_user_assignment_id', as: 'issueUserAssignment' });
IssueUserAssignments.hasMany(IssueDocuments, { foreignKey: 'issue_user_assignment_id', as: 'documents' });

// Tasks has many IssueAssignments
Tasks.hasMany(IssueAssignments, { foreignKey: 'task_id', as: 'issueAssignments' });

// ChangeIssueTasktype Associations (junction table between Tasks and IssueRegister)
ChangeIssueTasktype.belongsTo(Tasks, { foreignKey: 'task_id', as: 'task' });
ChangeIssueTasktype.belongsTo(IssueRegister, { foreignKey: 'change_issue_id', as: 'changeIssue' });
Tasks.hasMany(ChangeIssueTasktype, { foreignKey: 'task_id', as: 'changeIssueTypes' });
IssueRegister.hasMany(ChangeIssueTasktype, { foreignKey: 'change_issue_id', as: 'taskChangeIssues' });

// TaskReviewHistory Associations
TaskReviewHistory.belongsTo(Tasks, { foreignKey: 'task_id', as: 'task' });
TaskReviewHistory.belongsTo(User, { foreignKey: 'reviewer_id', as: 'reviewer' });
Tasks.hasMany(TaskReviewHistory, { foreignKey: 'task_id', as: 'reviewHistory' });
User.hasMany(TaskReviewHistory, { foreignKey: 'reviewer_id', as: 'taskReviews' });

module.exports = {
  sequelize,
  Department,
  Division,
  JobRole,
  Designation,
  DesignationDepartment,
  DesignationJobRole,
  Location,
  User,
  Sales,
  Tasks,
  UserDivisions,
  RequestType,
  RequestDivisionReference,
  WorkRequests,
  WorkRequestManagers,
  WorkRequestDocuments,
  ProjectType,
  TaskType,
  ProjectRequestReference,
  IssueRegister,
  TaskProjectReference,
  TaskDependencies,
  TaskAssignments,
  TaskDocuments,
  AboutProject,
  IssueAssignments,
  IssueUserAssignments,
  IssueDocuments,
  IssueAssignmentTypes,
  ChangeIssueTasktype,
  TaskReviewHistory
};