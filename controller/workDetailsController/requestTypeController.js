const { Op } = require('sequelize');
const CrudService = require('../../services/crudService');
const { RequestType } = require('../../models');

// Create service instance
const RequestTypeService = new CrudService(RequestType);

// Get all request types
const getAllRequestTypes = async (req, res) => {
    try {

        const where = {};

        if (req.query.exclude_request_type_id) {
            where.id = { [Op.ne]: parseInt(req.query.exclude_request_type_id) };
        }

        const RequestTypeResult = await RequestTypeService.getAll({
            where,
            attributes: ['id', 'type', 'category', 'description', 'division_id']
        });

        if (!RequestTypeResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to retrieve request types',
                message: 'Failed to retrieve request types'
            });
        }

        // Group by type
        const groupedData = RequestTypeResult.data.reduce((acc, item) => {
            if (!acc[item.type]) {
                acc[item.type] = [];
            }
            acc[item.type].push({
                id: item.id,
                category: item.category,
                description: item.description,
                division_id: item.division_id
            });
            return acc;
        }, {});

        res.status(200).json({
            success: true,
            data: groupedData,
            message: 'Request types retrieved successfully'
        });
    } catch (error) {
        console.error('Error in getAllRequestTypes:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to retrieve request types'
        });
    }
};

module.exports = getAllRequestTypes;