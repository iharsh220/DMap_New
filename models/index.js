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
const WorkMedium = require('./WorkMedium/WorkMedium');
const WorkRequests = require('./WorkRequests/WorkRequests');
const WorkRequestDocuments = require('./WorkRequestDocuments/WorkRequestDocuments');

// Associations
Department.hasMany(Division, { foreignKey: 'department_id' });
Division.belongsTo(Department, { foreignKey: 'department_id' });

Department.hasMany(JobRole, { foreignKey: 'department_id' });
JobRole.belongsTo(Department, { foreignKey: 'department_id' });

Designation.belongsToMany(Department, { through: DesignationDepartment, foreignKey: 'designation_id' });
Department.belongsToMany(Designation, { through: DesignationDepartment, foreignKey: 'department_id' });

Designation.belongsToMany(JobRole, { through: DesignationJobRole, foreignKey: 'designation_id' });
JobRole.belongsToMany(Designation, { through: DesignationJobRole, foreignKey: 'jobrole_id' });

User.belongsTo(Department, { foreignKey: 'department_id' });
User.belongsTo(Division, { foreignKey: 'division_id' });
User.belongsTo(JobRole, { foreignKey: 'job_role_id' });
User.belongsTo(Location, { foreignKey: 'location_id' });

User.belongsToMany(Division, { through: UserDivisions, foreignKey: 'user_id' });
Division.belongsToMany(User, { through: UserDivisions, foreignKey: 'division_id' });

Sales.belongsTo(Division, { foreignKey: 'division_id' });

Tasks.belongsTo(Division, { foreignKey: 'division_id' });
Tasks.belongsTo(WorkMedium, { foreignKey: 'work_medium_id' });
Tasks.belongsTo(User, { as: 'assignedBy', foreignKey: 'assigned_by_id' });
Tasks.belongsTo(User, { as: 'artist', foreignKey: 'artist_id' });
Tasks.belongsTo(User, { as: 'manager', foreignKey: 'manager_id' });

WorkMedium.belongsTo(Division, { foreignKey: 'division_id' });

WorkRequests.belongsTo(User, { foreignKey: 'user_id' });
WorkRequests.belongsTo(WorkMedium, { foreignKey: 'work_medium_id' });
WorkRequests.belongsTo(User, { as: 'requestedManager', foreignKey: 'requested_manager_id' });

WorkRequestDocuments.belongsTo(WorkRequests, { foreignKey: 'work_request_id' });

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
  WorkMedium,
  WorkRequests,
  WorkRequestDocuments
};