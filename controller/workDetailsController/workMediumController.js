const CrudService = require('../../services/crudService');
const { WorkMedium } = require('../../models');

// Create service instance
const workMediumService = new CrudService(WorkMedium);

// Get all work mediums
const getAllWorkMediums = async (req, res) => {
    try {
        const workMediumResult = await workMediumService.getAll({
            attributes: ['id', 'type', 'category', 'description', 'division_id']
        });

        if (!workMediumResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to retrieve work mediums',
                message: 'Failed to retrieve work mediums'
            });
        }

        // Group by type
        const groupedData = workMediumResult.data.reduce((acc, item) => {
            if (!acc[item.type]) {
                acc[item.type] = [];
            }
            acc[item.type].push({
                category: item.category,
                description: item.description,
                division_id: item.division_id
            });
            return acc;
        }, {});

        res.status(200).json({
            success: true,
            data: groupedData,
            message: 'Work mediums retrieved successfully'
        });
    } catch (error) {
        console.error('Error in getAllWorkMediums:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to retrieve work mediums'
        });
    }
};

module.exports = getAllWorkMediums;