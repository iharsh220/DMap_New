const CrudService = require('../../services/crudService');
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
                    attributes: ['id', 'title', 'description', 'state']
                }
            ],
            attributes: ['id', 'department_name', 'description', 'state']
        });

        // Get all locations
        const locationResult = await locationService.getAll({
            attributes: ['id', 'location_name', 'type', 'description', 'state']
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
                    ]
                });

                const designationDepartments = designationResult.success ? designationResult.data : [];

                return {
                    id: dept.id,
                    name: dept.department_name,
                    division: dept.divisions || [],
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