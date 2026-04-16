const CrudService = require('../../services/crudService');
const { Op } = require('sequelize');
const { Department, Division, Designation, DesignationDepartment, JobRole, Location } = require('../../models');

// Create service instances
const departmentService = new CrudService(Department);
const locationService = new CrudService(Location);
const designationDepartmentService = new CrudService(DesignationDepartment);

// Get all departments with nested divisions, designations, and locations
const getAllDepartments = async (req, res) => {
    try {
        // Get all departments with their divisions
        const departmentResult = await departmentService.getAll({
            include: [
                {
                    model: Division,
                    as: 'divisions',
                    attributes: ['id', 'title', 'description', 'state'],
                    order: [['title', 'ASC']]
                }
            ],
            attributes: ['id', 'department_name', 'description', 'state'],
            order: [['department_name', 'ASC']]
        });

        // Get all locations
        const locationResult = await locationService.getAll({
            attributes: ['id', 'location_name', 'type', 'description', 'state'],
            order: [['location_name', 'ASC']]
        });

        if (!departmentResult.success || !locationResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to retrieve data',
                message: 'Failed to retrieve departments and locations'
            });
        }

        // For each department, get its designations
        const departmentsWithDesignations = await Promise.all(
            departmentResult.data.map(async (dept) => {
                const designationResult = await designationDepartmentService.getAll({
                    where: { department_id: dept.id },
                    include: [
                        {
                            model: Designation,
                            as: 'designation',
                            attributes: ['id', 'designation_name', 'designation_category', 'state']
                        }
                    ],
                    order: [['designation', 'designation_name', 'ASC']]
                });

                const designationDepartments = designationResult.success ? designationResult.data : [];
                
                // If department name is Leadership, fetch ALL divisions except excluded ones
                let divisions = dept.divisions || [];
                if (dept.department_name && dept.department_name.toLowerCase().includes('leadership')) {
                    const excludedTitles = ['Graphic', 'Video', 'Shoot', 'Content', 'Web Application'];
                    const allDivisions = await Division.findAll({
                        attributes: ['id', 'title', 'description', 'state'],
                        where: {
                            title: {
                                [Op.notIn]: excludedTitles
                            }
                        },
                        order: [['title', 'ASC']]
                    });
                    divisions = allDivisions || [];
                }

                // Sort divisions alphabetically before returning
                divisions.sort((a, b) => a.title.localeCompare(b.title));
                
                return {
                    id: dept.id,
                    name: dept.department_name,
                    division: divisions,
                    designation: designationDepartments.map(dd => dd.designation).filter(Boolean)
                };
            })
        );

        res.status(200).json({
            success: true,
            data: {
                department: departmentsWithDesignations,
                location: locationResult.data
            },
            message: 'Departments and locations retrieved successfully'
        });
    } catch (error) {
        console.error('Error in getAllDepartments:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to retrieve departments and locations'
        });
    }
};

module.exports = getAllDepartments;