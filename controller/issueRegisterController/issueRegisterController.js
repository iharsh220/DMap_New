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
    TaskDocuments,
    TaskDependencies,
    UserDivisions,
    WorkRequests,
    WorkRequestManagers,
    RequestType,
    TaskType,
    JobRole,
    Division,
    Department,
    Location,
    Designation,
    RequestDivisionReference,
    TaskReviewHistory
} = require('../../models');

// Get issue register data by task ID
const getIssueRegisterByTaskId = async (req, res) => {
    try {
        const taskId = parseInt(req.params.task_id, 10);
        
        if (isNaN(taskId)) {
            return res.status(400).json({ success: false, error: 'Invalid task ID' });
        }

        const task = await Tasks.findByPk(taskId, { attributes: ['id', 'task_name', 'task_type_id'] });

        if (!task) {
            return res.status(404).json({ success: false, error: 'Task not found' });
        }

        const taskTypeId = task.task_type_id;

        if (!taskTypeId) {
            return res.status(400).json({ success: false, error: 'Task does not have a task_type_id associated' });
        }

        const issueRegisters = await IssueRegister.findAll({
            include: [{
                model: ChangeIssueTasktype,
                as: 'taskChangeIssues',
                where: { task_id: taskTypeId },
                attributes: ['id', 'task_id', 'change_issue_id'],
                required: true
            }],
            attributes: ['id', 'change_issue_type', 'description', 'quantification']
        });

        res.json({ success: true, data: { task: { id: task.id, task_name: task.task_name, task_type_id: task.task_type_id }, issue_registers: issueRegisters }, message: 'Issue register data retrieved successfully' });
    } catch (error) {
        console.error('Error fetching issue register data:', error);
        res.status(500).json({ success: false, error: error.message, message: 'Failed to fetch issue register data' });
    }
};

// Create issue assignment
const createIssueAssignment = async (req, res) => {
    const transaction = await require('../../models').sequelize.transaction();
    
    try {
        const { task_id, issue_id, requested_by_user_id, assignment_type, version, description, deadline, start_date, end_date, link, task_count = 0, intimate_team = 0, intimate_client = 0, issue_register_ids = [] } = req.body;

        if (!task_id && !issue_id) {
            return res.status(400).json({ success: false, error: 'Either task_id or issue_id is required' });
        }

        if (!requested_by_user_id || !assignment_type || !version) {
            return res.status(400).json({ success: false, error: 'Missing required fields: requested_by_user_id, assignment_type, version' });
        }

        if (task_id) {
            const task = await Tasks.findByPk(task_id);
            if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
            if (task.intimate_client !== 1) return res.status(400).json({ success: false, error: 'Task does not have intimate_client enabled' });
        }

        if (issue_id) {
            const existingIssue = await IssueAssignments.findByPk(issue_id);
            if (!existingIssue) return res.status(404).json({ success: false, error: 'Parent issue not found' });
            if (existingIssue.intimate_client !== 1) return res.status(400).json({ success: false, error: 'Parent issue does not have intimate_client enabled' });
        }

        const changeType = task_id ? 'task' : 'issue';

        const issueAssignment = await IssueAssignments.create({
            issue_id: issue_id || null,
            task_id: task_id || null,
            requested_by_user_id,
            assignment_type,
            version,
            description,
            deadline,
            start_date,
            end_date,
            link,
            task_count,
            intimate_team,
            intimate_client,
            status: 'pending',
            review: 'pending'
        }, { transaction });

        if (task_id) {
            await Tasks.update({ review: 'change_request' }, { where: { id: task_id }, transaction });
        }

        if (issue_register_ids && issue_register_ids.length > 0) {
            const issueTypeLinks = issue_register_ids.map(registerId => ({
                issue_assignment_id: issueAssignment.id,
                issue_register_id: registerId
            }));
            await IssueAssignmentTypes.bulkCreate(issueTypeLinks, { transaction });
        }

        await transaction.commit();

        const createdIssueAssignment = await IssueAssignments.findByPk(issueAssignment.id, {
            include: [
                { model: Tasks, as: 'task', attributes: ['id', 'task_name', 'task_type_id', 'work_request_id'] },
                { model: IssueAssignments, as: 'parentIssue', attributes: ['id', 'version', 'description'] },
                { model: User, as: 'requester', attributes: ['id', 'name', 'email'] },
                { model: IssueRegister, as: 'issueTypes', through: { attributes: [] }, attributes: ['id', 'change_issue_type', 'description'] }
            ]
        });

        res.status(201).json({ success: true, data: { ...createdIssueAssignment.toJSON(), change_type: changeType }, message: 'Issue assignment created successfully' });
    } catch (error) {
        await transaction.rollback();
        console.error('Error creating issue assignment:', error);
        res.status(500).json({ success: false, error: error.message, message: 'Failed to create issue assignment' });
    }
};

const getAllIssueRegisters = async (req, res) => {
    try {
        const issueRegisters = await IssueRegister.findAll({ attributes: ['id', 'change_issue_type', 'description', 'quantification'], order: [['id', 'ASC']] });
        res.json({ success: true, data: issueRegisters, message: 'All issue register entries retrieved successfully' });
    } catch (error) {
        console.error('Error fetching issue register data:', error);
        res.status(500).json({ success: false, error: error.message, message: 'Failed to fetch issue register data' });
    }
};

// Get issue assignments with task's managers (from request_type -> divisions)
const getIssueAssignmentsWithTaskDetails = async (req, res) => {
    try {
        const { task_id, status } = req.query;
        let whereCondition = {};
        
        if (task_id) whereCondition.task_id = parseInt(task_id);
        if (status) whereCondition.status = status;

        // Get issue assignments with simple includes
        const issueAssignments = await IssueAssignments.findAll({
            where: whereCondition,
            include: [
                {
                    model: Tasks,
                    as: 'task',
                    include: [
                        { model: RequestType, attributes: ['id', 'request_type', 'description'] },
                        { model: TaskType, attributes: ['id', 'task_type', 'description'] },
                        { model: WorkRequests, attributes: ['id', 'project_name', 'brand', 'description', 'priority', 'status', 'requested_at'], include: [{ model: User, as: 'users', attributes: ['id', 'name', 'email'] }] },
                        { model: TaskDependencies, as: 'dependencies', attributes: ['id', 'dependency_task_id'], include: [{ model: Tasks, as: 'dependencyTask', attributes: ['id', 'task_name', 'status'] }] },
                        { model: TaskReviewHistory, as: 'reviewHistory', attributes: ['id', 'reviewer_id', 'reviewer_type', 'action', 'comments', 'previous_stage', 'new_stage'], include: [{ model: User, as: 'reviewer', attributes: ['id', 'name', 'email'] }] }
                    ]
                },
                { model: IssueAssignments, as: 'parentIssue', attributes: ['id', 'version', 'description', 'status', 'assignment_type'] },
                { model: User, as: 'requester', attributes: ['id', 'name', 'email', 'job_role_id'], include: [{ model: JobRole, attributes: ['id', 'role_title'] }] },
                { model: IssueAssignmentTypes, as: 'issueTypeLinks', attributes: ['id', 'issue_register_id'], include: [{ model: IssueRegister, as: 'issueRegister', attributes: ['id', 'change_issue_type', 'description', 'quantification'] }] },
                { model: IssueUserAssignments, as: 'userAssignments', attributes: ['id', 'issue_assignment_id', 'user_id'], include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'job_role_id'], include: [{ model: JobRole, attributes: ['id', 'role_title'] }, { model: Designation, attributes: ['id', 'designation_name'] }, { model: Department, attributes: ['id', 'department_name'] }, { model: Location, attributes: ['id', 'location_name'] }] }] }
            ]
        });

        const result = [];
        
        for (const issueAssignment of issueAssignments) {
            const task = issueAssignment.task;
            let taskDocuments = [];
            let managers = []; // Task ke request_type ke divisions ke managers
            
            if (task && task.request_type_id) {
                // Get divisions linked to this task's request_type
                const requestDivisionRefs = await RequestDivisionReference.findAll({
                    where: { request_id: task.request_type_id }
                });
                
                const divisionIds = requestDivisionRefs.map(ref => ref.division_id);
                
                if (divisionIds.length > 0) {
                    // Get creative managers (job_role_id = 2) from these divisions
                    const divisionManagers = await UserDivisions.findAll({
                        where: { division_id: { [Op.in]: divisionIds } },
                        include: [{
                            model: User,
                            where: { job_role_id: 2, account_status: 'active' },
                            attributes: ['id', 'name', 'email', 'job_role_id'],
                            include: [
                                { model: JobRole, attributes: ['id', 'role_title'] },
                                { model: Designation, attributes: ['id', 'designation_name'] },
                                { model: Department, attributes: ['id', 'department_name'] },
                                { model: Location, attributes: ['id', 'location_name'] }
                            ]
                        }]
                    });
                    
                    managers = divisionManagers
                        .filter(dm => dm.User)
                        .map(dm => ({
                            id: dm.User.id, 
                            name: dm.User.name, 
                            email: dm.User.email, 
                            job_role_id: dm.User.job_role_id,
                            role_title: dm.User.JobRole ? dm.User.JobRole.role_title : null,
                            designation_name: dm.User.Designation ? dm.User.Designation.designation_name : null,
                            department_name: dm.User.Department ? dm.User.Department.department_name : null,
                            location_name: dm.User.Location ? dm.User.Location.location_name : null
                        }));
                }
                
                // Get task documents via task_assignments
                const taskAssignments = await TaskAssignments.findAll({ where: { task_id: task.id } });
                const taskAssignmentIds = taskAssignments.map(ta => ta.id);
                
                if (taskAssignmentIds.length > 0) {
                    const docs = await TaskDocuments.findAll({ 
                        where: { task_assignment_id: { [Op.in]: taskAssignmentIds } }, 
                        attributes: ['id', 'document_name', 'document_path', 'document_type', 'document_size', 'version', 'status', 'review', 'intimate_client', 'task_assignment_id'] 
                    });
                    taskDocuments = docs.map(doc => ({ 
                        id: doc.id, 
                        document_name: doc.document_name, 
                        document_path: doc.document_path, 
                        document_type: doc.document_type, 
                        document_size: doc.document_size, 
                        version: doc.version, 
                        status: doc.status, 
                        review: doc.review, 
                        intimate_client: doc.intimate_client, 
                        task_assignment_id: doc.task_assignment_id 
                    }));
                }
            }

            // Process issue types
            const issueTypes = issueAssignment.issueTypeLinks ? issueAssignment.issueTypeLinks.map(itl => ({ 
                id: itl.id, 
                issue_register_id: itl.issue_register_id, 
                change_issue_type: itl.issueRegister ? itl.issueRegister.change_issue_type : null, 
                issue_description: itl.issueRegister ? itl.issueRegister.description : null, 
                issue_quantification: itl.issueRegister ? itl.issueRegister.quantification : null 
            })) : [];
            
            // Process user assignments
            const userAssignments = issueAssignment.userAssignments ? issueAssignment.userAssignments.map(ua => ({ 
                id: ua.id, 
                issue_assignment_id: ua.issue_assignment_id, 
                user_id: ua.user_id, 
                user: ua.user ? { 
                    id: ua.user.id, 
                    name: ua.user.name, 
                    email: ua.user.email, 
                    job_role_id: ua.user.job_role_id, 
                    role_title: ua.user.JobRole ? ua.user.JobRole.role_title : null, 
                    designation_name: ua.user.Designation ? ua.user.Designation.designation_name : null, 
                    department_name: ua.user.Department ? ua.user.Department.department_name : null, 
                    location_name: ua.user.Location ? ua.user.Location.location_name : null 
                } : null 
            })) : [];
            
            // Process dependencies
            const dependencies = task && task.dependencies ? task.dependencies.map(dep => ({ 
                id: dep.id, 
                dependency_task_id: dep.dependency_task_id, 
                dependency_task: dep.dependencyTask ? { 
                    id: dep.dependencyTask.id, 
                    task_name: dep.dependencyTask.task_name, 
                    status: dep.dependencyTask.status 
                } : null 
            })) : [];
            
            // Process review history
            const reviewHistory = task && task.reviewHistory ? task.reviewHistory.map(rh => ({ 
                id: rh.id, 
                reviewer_id: rh.reviewer_id, 
                reviewer_type: rh.reviewer_type, 
                action: rh.action, 
                comments: rh.comments, 
                previous_stage: rh.previous_stage, 
                new_stage: rh.new_stage, 
                reviewer: rh.reviewer ? { 
                    id: rh.reviewer.id, 
                    name: rh.reviewer.name, 
                    email: rh.reviewer.email 
                } : null 
            })) : [];

            result.push({
                issue_assignment: { 
                    id: issueAssignment.id, 
                    issue_id: issueAssignment.issue_id, 
                    task_id: issueAssignment.task_id, 
                    requested_by_user_id: issueAssignment.requested_by_user_id, 
                    assignment_type: issueAssignment.assignment_type, 
                    version: issueAssignment.version, 
                    description: issueAssignment.description, 
                    deadline: issueAssignment.deadline, 
                    start_date: issueAssignment.start_date, 
                    end_date: issueAssignment.end_date, 
                    link: issueAssignment.link, 
                    task_count: issueAssignment.task_count, 
                    status: issueAssignment.status, 
                    review: issueAssignment.review, 
                    intimate_team: issueAssignment.intimate_team, 
                    intimate_client: issueAssignment.intimate_client 
                },
                // Requester - just show the requester who created this issue_assignment
                requester: issueAssignment.requester ? { 
                    id: issueAssignment.requester.id, 
                    name: issueAssignment.requester.name, 
                    email: issueAssignment.requester.email, 
                    job_role_id: issueAssignment.requester.job_role_id, 
                    role_title: issueAssignment.requester.JobRole ? issueAssignment.requester.JobRole.role_title : null 
                } : null,
                task: task ? { 
                    id: task.id, 
                    task_name: task.task_name, 
                    description: task.description, 
                    request_type_id: task.request_type_id, 
                    request_type: task.requesttype ? { 
                        id: task.requesttype.id, 
                        request_type: task.requesttype.request_type, 
                        description: task.requesttype.description 
                    } : null, 
                    task_type_id: task.task_type_id, 
                    task_type: task.tasktype ? { 
                        id: task.tasktype.id, 
                        task_type: task.tasktype.task_type, 
                        description: task.tasktype.description 
                    } : null, 
                    work_request_id: task.work_request_id, 
                    work_request: task.workrequest ? { 
                        id: task.workrequest.id, 
                        project_name: task.workrequest.project_name, 
                        brand: task.workrequest.brand, 
                        description: task.workrequest.description, 
                        priority: task.workrequest.priority, 
                        status: task.workrequest.status, 
                        requested_at: task.workrequest.requested_at, 
                        client: task.workrequest.users ? { 
                            id: task.workrequest.users.id, 
                            name: task.workrequest.users.name, 
                            email: task.workrequest.users.email 
                        } : null 
                    } : null, 
                    deadline: task.deadline, 
                    status: task.status, 
                    version: task.version, 
                    assignment_type: task.assignment_type, 
                    intimate_team: task.intimate_team, 
                    intimate_client: task.intimate_client, 
                    task_count: task.task_count, 
                    link: task.link, 
                    start_date: task.start_date, 
                    end_date: task.end_date, 
                    review: task.review, 
                    review_stage: task.review_stage, 
                    task_documents: taskDocuments, 
                    dependencies: dependencies, 
                    review_history: reviewHistory 
                } : null,
                // Managers - task ke request_type ke divisions ke creative managers (job_role_id = 2)
                managers: managers,
                issue_types: issueTypes,
                user_assignments: userAssignments
            });
        }

        res.json({ success: true, data: result, message: 'Issue assignments with full details retrieved successfully' });
    } catch (error) {
        console.error('Error fetching issue assignments with task details:', error);
        res.status(500).json({ success: false, error: error.message, message: 'Failed to fetch issue assignments with task details' });
    }
};

module.exports = {
    getIssueRegisterByTaskId,
    getAllIssueRegisters,
    createIssueAssignment,
    getIssueAssignmentsWithTaskDetails
};
