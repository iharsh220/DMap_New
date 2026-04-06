-- =====================================================
-- SINGLE TABLE: WORK REQUEST + TASKS + USERS + ISSUES
-- Returns ALL fields from work_requests, tasks, and issue_assignments tables
-- =====================================================

SELECT 
    -- =====================================================
    -- ALL FIELDS FROM work_requests TABLE
    -- =====================================================
    wr.id AS work_request_id,
    wr.user_id AS work_request_user_id,
    wr.project_name,
    wr.brand,
    wr.request_type_id AS work_request_type_id,
    wr.project_id AS work_request_project_id,
    wr.description AS work_request_description,
    wr.about_project,
    wr.priority,
    wr.status AS work_request_status,
    wr.requested_at,
    wr.remarks,
    wr.created_at AS work_request_created_at,
    wr.updated_at AS work_request_updated_at,
    
    -- Request Type Details
    rt.id AS request_type_id,
    rt.request_type AS request_type_name,
    rt.description AS request_type_description,
    
    -- Project Type Details
    pt.id AS project_type_id,
    pt.project_type AS project_type_name,
    pt.description AS project_type_description,
    
    -- Work Request Creator (User who created the request)
    creator.id AS request_creator_id,
    creator.name AS request_creator_name,
    creator.email AS request_creator_email,
    creator.phone AS request_creator_phone,
    creator_dept.department_name AS request_creator_department,
    creator_desig.designation_name AS request_creator_designation,
    creator_job.role_title AS request_creator_job_role,
    creator_loc.location_name AS request_creator_location,
    
    -- Manager Details (comma-separated)
    (SELECT GROUP_CONCAT(u.name SEPARATOR ', ')
     FROM work_request_managers wrm
     JOIN users u ON u.id = wrm.manager_id
     WHERE wrm.work_request_id = wr.id) AS manager_names,
    
    (SELECT GROUP_CONCAT(wrm.manager_id SEPARATOR ', ')
     FROM work_request_managers wrm
     WHERE wrm.work_request_id = wr.id) AS manager_ids,
    
    -- =====================================================
    -- ALL FIELDS FROM tasks TABLE
    -- =====================================================
    t.id AS task_id,
    t.task_name,
    t.description AS task_description,
    t.request_type_id AS task_request_type_id,
    t.task_type_id,
    t.work_request_id AS task_work_request_id,
    t.deadline AS task_deadline,
    t.status AS task_status,
    t.version AS task_version,
    t.review AS task_review,
    t.review_stage AS task_review_stage,
    t.assignment_type AS task_assignment_type,
    t.intimate_team AS task_intimate_team,
    t.intimate_client AS task_intimate_client,
    t.shared_with_client_at AS task_shared_with_client_at,
    t.task_count AS task_count,
    t.link AS task_link,
    t.start_date AS task_start_date,
    t.end_date AS task_end_date,
    t.no_of_options_provided AS task_no_of_options_provided,
    t.no_of_words_written AS task_no_of_words_written,
    t.options_submitted AS task_options_submitted,
    t.concept_work AS task_concept_work,
    t.resize_work AS task_resize_work,
    t.no_of_concepts AS task_no_of_concepts,
    t.duration_minutes AS task_duration_minutes,
    t.duration_seconds AS task_duration_seconds,
    t.product_shoot AS task_product_shoot,
    t.no_of_products_shot AS task_no_of_products_shot,
    t.shoot_setup AS task_shoot_setup,
    t.no_of_resize AS task_no_of_resize,
    t.responsive_screen AS task_responsive_screen,
    t.no_of_responsive_screen AS task_no_of_responsive_screen,
    t.created_at AS task_created_at,
    t.updated_at AS task_updated_at,
    t.comments AS task_comments,
    
    -- Task Type Details
    tt.id AS task_type_id,
    tt.task_type AS task_type_name,
    tt.description AS task_type_description,
    
    -- Task Request Type Details
    task_rt.id AS task_request_type_id,
    task_rt.request_type AS task_request_type_name,
    
    -- =====================================================
    -- Task Assignee (User assigned to task) - from task_assignments
    -- =====================================================
    ta.id AS task_assignment_id,
    ta.user_id AS assigned_user_id,
    assignee.name AS assigned_user_name,
    assignee.email AS assigned_user_email,
    assignee.phone AS assigned_user_phone,
    assignee_dept.department_name AS assigned_user_department,
    assignee_desig.designation_name AS assigned_user_designation,
    assignee_job.role_title AS assigned_user_job_role,
    assignee_loc.location_name AS assigned_user_location,
    
    -- =====================================================
    -- ALL FIELDS FROM issue_assignments TABLE
    -- =====================================================
    ia.id AS issue_id,
    ia.issue_id AS issue_parent_id,
    ia.task_id AS issue_task_id,
    ia.requested_by_user_id AS issue_requested_by_user_id,
    ia.assignment_type AS issue_assignment_type,
    ia.version AS issue_version,
    ia.description AS issue_description,
    ia.deadline AS issue_deadline,
    ia.intimate_team AS issue_intimate_team,
    ia.intimate_client AS issue_intimate_client,
    ia.shared_with_client_at AS issue_shared_with_client_at,
    ia.task_count AS issue_task_count,
    ia.start_date AS issue_start_date,
    ia.end_date AS issue_end_date,
    ia.link AS issue_link,
    ia.status AS issue_status,
    ia.review AS issue_review,
    ia.review_stage AS issue_review_stage,
    ia.no_of_options_provided AS issue_no_of_options_provided,
    ia.no_of_words_written AS issue_no_of_words_written,
    ia.options_submitted AS issue_options_submitted,
    ia.concept_work AS issue_concept_work,
    ia.resize_work AS issue_resize_work,
    ia.no_of_concepts AS issue_no_of_concepts,
    ia.duration_minutes AS issue_duration_minutes,
    ia.duration_seconds AS issue_duration_seconds,
    ia.product_shoot AS issue_product_shoot,
    ia.no_of_products_shot AS issue_no_of_products_shot,
    ia.shoot_setup AS issue_shoot_setup,
    ia.no_of_resize AS issue_no_of_resize,
    ia.responsive_screen AS issue_responsive_screen,
    ia.no_of_responsive_screen AS issue_no_of_responsive_screen,
    ia.created_at AS issue_created_at,
    ia.updated_at AS issue_updated_at,
    ia.comments AS issue_comments,
    
    -- Issue Requester (User who requested the issue)
    issue_requester.id AS issue_requester_id,
    issue_requester.name AS issue_requester_name,
    issue_requester.email AS issue_requester_email,
    issue_requester.phone AS issue_requester_phone,
    issue_requester_dept.department_name AS issue_requester_department,
    issue_requester_desig.designation_name AS issue_requester_designation,
    issue_requester_job.role_title AS issue_requester_job_role,
    issue_requester_loc.location_name AS issue_requester_location,
    
    -- Issue Register Details (comma-separated - multiple issue_register_id per issue)
    (SELECT GROUP_CONCAT(ir.change_issue_type SEPARATOR ', ')
     FROM issue_assignment_types iat
     JOIN issue_register ir ON ir.id = iat.issue_register_id
     WHERE iat.issue_assignment_id = ia.id) AS issue_types,
    
    (SELECT GROUP_CONCAT(ir.id SEPARATOR ', ')
     FROM issue_assignment_types iat
     JOIN issue_register ir ON ir.id = iat.issue_register_id
     WHERE iat.issue_assignment_id = ia.id) AS issue_register_ids,
    
    (SELECT GROUP_CONCAT(CONCAT(ir.change_issue_type, ' - ', ir.description) SEPARATOR ' | ')
     FROM issue_assignment_types iat
     JOIN issue_register ir ON ir.id = iat.issue_register_id
     WHERE iat.issue_assignment_id = ia.id) AS issue_types_with_description

FROM work_requests wr
-- Request Type join
LEFT JOIN request_type rt ON rt.id = wr.request_type_id
-- Project Type join
LEFT JOIN project_type pt ON pt.id = wr.project_id
-- Work Request Creator (User) join
LEFT JOIN users creator ON creator.id = wr.user_id
LEFT JOIN department creator_dept ON creator_dept.id = creator.department_id
LEFT JOIN designation creator_desig ON creator_desig.id = creator.designation_id
LEFT JOIN job_role creator_job ON creator_job.id = creator.job_role_id
LEFT JOIN location creator_loc ON creator_loc.id = creator.location_id
-- Tasks join
LEFT JOIN tasks t ON t.work_request_id = wr.id
-- Task Type join
LEFT JOIN task_type tt ON tt.id = t.task_type_id
-- Task Request Type join
LEFT JOIN request_type task_rt ON task_rt.id = t.request_type_id
-- Task Assignments join
LEFT JOIN task_assignments ta ON ta.task_id = t.id
-- Assigned User (Task Assignee) join
LEFT JOIN users assignee ON assignee.id = ta.user_id
LEFT JOIN department assignee_dept ON assignee_dept.id = assignee.department_id
LEFT JOIN designation assignee_desig ON assignee_desig.id = assignee.designation_id
LEFT JOIN job_role assignee_job ON assignee_job.id = assignee.job_role_id
LEFT JOIN location assignee_loc ON assignee_loc.id = assignee.location_id
-- Issue Assignments join (linked to task)
LEFT JOIN issue_assignments ia ON ia.task_id = t.id
-- Issue Requester (User who requested the issue)
LEFT JOIN users issue_requester ON issue_requester.id = ia.requested_by_user_id
LEFT JOIN department issue_requester_dept ON issue_requester_dept.id = issue_requester.department_id
LEFT JOIN designation issue_requester_desig ON issue_requester_desig.id = issue_requester.designation_id
LEFT JOIN job_role issue_requester_job ON issue_requester_job.id = issue_requester.job_role_id
LEFT JOIN location issue_requester_loc ON issue_requester_loc.id = issue_requester.location_id

-- Only show work requests assigned to managers
WHERE wr.id IN (SELECT work_request_id FROM work_request_managers)

ORDER BY wr.id DESC, t.id ASC, ta.id ASC, ia.id ASC;