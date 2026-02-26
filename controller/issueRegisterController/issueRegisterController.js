const { Op } = require('sequelize');
const {
    IssueRegister,
    ChangeIssueTasktype,
    Tasks,
    IssueAssignments,
    IssueAssignmentTypes,
    IssueUserAssignments,
    IssueDocuments,
    User,
    TaskAssignments,
    UserDivisions,
    WorkRequests,
    WorkRequestManagers,
    RequestType,
    TaskType,
    JobRole,
    Division,
    Department,
    Location,
    Designation
} = require('../../models');
const { sendMail } = require('../../services/mailService');
const { renderTemplate } = require('../../services/templateService');
const path = require('path');

// Get issue register data by task ID
// Logic: task_id -> get task_type_id from tasks -> find issue_register via change_issue_tasktype
const getIssueRegisterByTaskId = async (req, res) => {
    try {
        const taskId = parseInt(req.params.task_id, 10);
        
        if (isNaN(taskId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid task ID'
            });
        }

        // Check if task exists and get task_type_id
        const task = await Tasks.findByPk(taskId, {
            attributes: ['id', 'task_name', 'task_type_id']
        });

        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Task not found'
            });
        }

        const taskTypeId = task.task_type_id;

        if (!taskTypeId) {
            return res.status(400).json({
                success: false,
                error: 'Task does not have a task_type_id associated'
            });
        }

        // Get issue register entries linked to this task_type_id through change_issue_tasktype
        // Note: change_issue_tasktype.task_id actually stores task_type_id (naming inconsistency in table)
        const issueRegisters = await IssueRegister.findAll({
            include: [
                {
                    model: ChangeIssueTasktype,
                    as: 'taskChangeIssues',
                    where: { task_id: taskTypeId }, // This is task_type_id
                    attributes: ['id', 'task_id', 'change_issue_id', 'created_at', 'updated_at'],
                    required: true
                }
            ],
            attributes: ['id', 'change_issue_type', 'description', 'quantification', 'created_at', 'updated_at']
        });

        res.json({
            success: true,
            data: {
                task: {
                    id: task.id,
                    task_name: task.task_name,
                    task_type_id: task.task_type_id
                },
                issue_registers: issueRegisters
            },
            message: 'Issue register data retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching issue register data:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to fetch issue register data'
        });
    }
};

// Create issue assignment with issue types
const createIssueAssignment = async (req, res) => {
    const transaction = await require('../../models').sequelize.transaction();
    
    try {
        const {
            task_id,
            issue_id,
            requested_by_user_id,
            assignment_type,
            version,
            description,
            // Array of issue_register IDs
            issue_register_ids = []
        } = req.body;

        // Validate required fields - either task_id or issue_id must be provided
        if (!task_id && !issue_id) {
            return res.status(400).json({
                success: false,
                error: 'Either task_id or issue_id is required'
            });
        }

        if (!requested_by_user_id || !assignment_type || !version) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: requested_by_user_id, assignment_type, version'
            });
        }

        // Check if task exists (if task_id provided)
        if (task_id) {
            const task = await Tasks.findByPk(task_id);
            if (!task) {
                return res.status(404).json({
                    success: false,
                    error: 'Task not found'
                });
            }
            
            // Validate: task must have intimate_client = 1 to create issue assignment
            if (task.intimate_client !== 1) {
                return res.status(400).json({
                    success: false,
                    error: 'Task does not have intimate_client enabled. Only tasks with intimate_client=1 can have issue assignments.'
                });
            }
        }

        // Check if issue exists (if issue_id provided)
        if (issue_id) {
            const existingIssue = await IssueAssignments.findByPk(issue_id);
            if (!existingIssue) {
                return res.status(404).json({
                    success: false,
                    error: 'Parent issue not found'
                });
            }
            
            // Validate: issue must have intimate_client = 1 to create sub-issue assignment
            if (existingIssue.intimate_client !== 1) {
                return res.status(400).json({
                    success: false,
                    error: 'Parent issue does not have intimate_client enabled. Only issues with intimate_client=1 can have sub-issue assignments.'
                });
            }
        }

        // Determine change type
        const changeType = task_id ? 'task' : 'issue';

        // Create issue assignment
        const issueAssignment = await IssueAssignments.create({
            issue_id: issue_id || null,
            task_id: task_id || null,
            requested_by_user_id,
            assignment_type,
            version,
            description,
            status: 'pending',
            review: 'pending'
        }, { transaction });

        // If task_id is provided, update task's review to 'change_request'
        if (task_id) {
            await Tasks.update(
                { review: 'change_request' },
                { where: { id: task_id }, transaction }
            );
        }

        // Link issue_register IDs (multiple)
        if (issue_register_ids && issue_register_ids.length > 0) {
            const issueTypeLinks = issue_register_ids.map(registerId => ({
                issue_assignment_id: issueAssignment.id,
                issue_register_id: registerId
            }));
            await IssueAssignmentTypes.bulkCreate(issueTypeLinks, { transaction });
        }

        await transaction.commit();

        // If task_id is provided, send email to managers of users assigned to this task
        if (task_id) {
            try {
                // Fetch task with full details
                const taskDetails = await Tasks.findByPk(task_id, {
                    include: [
                        {
                            model: TaskType,
                            attributes: ['id', 'task_type', 'description']
                        },
                        {
                            model: WorkRequests,
                            attributes: ['id', 'project_name', 'brand', 'priority', 'status'],
                            include: [
                                {
                                    model: User,
                                    as: 'users',
                                    attributes: ['id', 'name', 'email']
                                },
                                {
                                    model: RequestType,
                                    attributes: ['id', 'request_type', 'description']
                                }
                            ]
                        }
                    ]
                });

                // Fetch issue register details for this issue assignment
                const issueRegisters = await IssueRegister.findAll({
                    where: { id: { [Op.in]: issue_register_ids } }
                });

                // Get all users assigned to this task
                const taskAssignments = await TaskAssignments.findAll({
                    where: { task_id: task_id },
                    include: [
                        {
                            model: User,
                            attributes: ['id', 'name', 'email']
                        }
                    ]
                });

                // Collect unique manager IDs from task users' divisions
                const managerSet = new Set();
                
                for (const assignment of taskAssignments) {
                    const userId = assignment.user_id;
                    
                    // Find divisions this user belongs to
                    const userDivisions = await UserDivisions.findAll({
                        where: { user_id: userId },
                        attributes: ['division_id']
                    });

                    if (userDivisions.length > 0) {
                        const divisionIds = userDivisions.map(ud => ud.division_id);
                        
                        // Find managers in these divisions (users with job_role_id = 2)
                        const divisionManagers = await UserDivisions.findAll({
                            where: { division_id: { [Op.in]: divisionIds } },
                            include: [
                                {
                                    model: User,
                                    where: { job_role_id: 2, account_status: 'active' },
                                    attributes: ['id', 'name', 'email', 'job_role_id'],
                                    include: [
                                        {
                                            model: JobRole,
                                            attributes: ['id', 'role_title']
                                        },
                                        {
                                            model: Designation,
                                            attributes: ['id', 'designation_name']
                                        },
                                        {
                                            model: Department,
                                            attributes: ['id', 'department_name']
                                        },
                                        {
                                            model: Location,
                                            attributes: ['id', 'location_name']
                                        }
                                    ]
                                }
                            ],
                            attributes: ['user_id']
                        });

                        divisionManagers.forEach(dm => {
                            if (dm.User) {
                                managerSet.add(JSON.stringify(dm.User));
                            }
                        });
                    }
                }

                // Convert Set to array and remove duplicates
                const uniqueManagers = [...managerSet].map(m => JSON.parse(m));

                // Send email to each manager
                for (const manager of uniqueManagers) {
                    const html = renderTemplate('issueAssignmentNotification', {
                        manager_name: manager.name,
                        task_id: taskDetails.id,
                        task_name: taskDetails.task_name,
                        task_type: taskDetails.TaskType ? taskDetails.TaskType.task_type : 'N/A',
                        project_name: taskDetails.WorkRequest ? taskDetails.WorkRequest.project_name : 'N/A',
                        brand: taskDetails.WorkRequest ? taskDetails.WorkRequest.brand : 'N/A',
                        priority: taskDetails.WorkRequest ? taskDetails.WorkRequest.priority : 'N/A',
                        request_type: taskDetails.WorkRequest && taskDetails.WorkRequest.RequestType ? taskDetails.WorkRequest.RequestType.request_type : 'N/A',
                        issue_version: version,
                        issue_description: description,
                        issue_registers: issueRegisters.map(ir => ({
                            change_issue_type: ir.change_issue_type,
                            description: ir.description,
                            quantification: ir.quantification
                        })),
                        assigned_users: taskAssignments.map(ta => ({
                            name: ta.User.name,
                            email: ta.User.email
                        })),
                        created_at: new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })
                    });

                    await sendMail({
                        to: manager.email,
                        subject: `New Issue Assignment - Task: ${taskDetails.task_name} (${version})`,
                        html: html
                    });
                }

                console.log(`Sent issue assignment notification to ${uniqueManagers.length} managers`);
            } catch (emailError) {
                console.error('Error sending issue assignment emails:', emailError);
                // Don't fail the request if email fails
            }
        }

        // Fetch the created issue assignment with all related data
        const createdIssueAssignment = await IssueAssignments.findByPk(issueAssignment.id, {
            include: [
                {
                    model: Tasks,
                    as: 'task',
                    attributes: ['id', 'task_name', 'task_type_id', 'work_request_id']
                },
                {
                    model: IssueAssignments,
                    as: 'parentIssue',
                    attributes: ['id', 'version', 'description']
                },
                {
                    model: User,
                    as: 'requester',
                    attributes: ['id', 'name', 'email']
                },
                {
                    model: IssueRegister,
                    as: 'issueTypes',
                    through: { attributes: [] },
                    attributes: ['id', 'change_issue_type', 'description']
                }
            ]
        });

        res.status(201).json({
            success: true,
            data: {
                ...createdIssueAssignment.toJSON(),
                change_type: changeType
            },
            message: 'Issue assignment created successfully'
        });

    } catch (error) {
        await transaction.rollback();
        console.error('Error creating issue assignment:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to create issue assignment'
        });
    }
};
const getAllIssueRegisters = async (req, res) => {
    try {
        const issueRegisters = await IssueRegister.findAll({
            attributes: ['id', 'change_issue_type', 'description', 'quantification', 'created_at', 'updated_at'],
            order: [['id', 'ASC']]
        });

        res.json({
            success: true,
            data: issueRegisters,
            message: 'All issue register entries retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching issue register data:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to fetch issue register data'
        });
    }
};

module.exports = {
    getIssueRegisterByTaskId,
    getAllIssueRegisters,
    createIssueAssignment
};
