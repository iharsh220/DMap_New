const { Op } = require('sequelize');
const CrudService = require('../../services/crudService');
const { RequestType, Division, User, UserDivisions } = require('../../models');

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
            attributes: ['id', 'request_type', 'description'],
            include: [
                {
                    model: Division,
                    through: { attributes: [] },
                    attributes: ['id', 'title']
                }
            ]
        });

        if (!RequestTypeResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to retrieve request types',
                message: 'Failed to retrieve request types'
            });
        }

        // Collect all division ids
        const divisionIds = [];
        RequestTypeResult.data.forEach(item => {
            item.Divisions.forEach(division => {
                if (!divisionIds.includes(division.id)) {
                    divisionIds.push(division.id);
                }
            });
        });

        // Get creative managers and leads for these divisions
        const creativeManagers = {};
        const creativeLeads = {};
        if (divisionIds.length > 0) {
            const managerResults = await UserDivisions.findAll({
                where: {
                    division_id: { [Op.in]: divisionIds }
                },
                include: [{
                    model: User,
                    attributes: ['id', 'name', 'job_role_id', 'account_status']
                }],
                attributes: ['division_id']
            });

            managerResults.forEach(result => {
                const user = result.User;
                if (user && user.account_status === 'active' && (user.job_role_id === 2 || user.job_role_id === 3)) {
                    if (user.job_role_id === 2) {
                        if (!creativeManagers[result.division_id]) {
                            creativeManagers[result.division_id] = [];
                        }
                        creativeManagers[result.division_id].push(user);
                    } else if (user.job_role_id === 3) {
                        if (!creativeLeads[result.division_id]) {
                            creativeLeads[result.division_id] = [];
                        }
                        creativeLeads[result.division_id].push(user);
                    }
                }
            });
        }
        // Group by request_type and collect divisions
        const groupedData = RequestTypeResult.data.reduce((acc, item) => {
            if (!acc[item.request_type]) {
                acc[item.request_type] = { items: [], divisions: new Set() };
            }
            acc[item.request_type].items.push({
                id: item.id,
                description: item.description
            });
            item.Divisions.forEach(div => acc[item.request_type].divisions.add(div.id));
            return acc;
        }, {});

        // Now add creative managers and leads to each group
        Object.keys(groupedData).forEach(requestType => {
            const divisions = Array.from(groupedData[requestType].divisions);
            const managers = [];
            const leads = [];
            divisions.forEach(divId => {
                if (creativeManagers[divId]) {
                    managers.push(...creativeManagers[divId]);
                }
                if (creativeLeads[divId]) {
                    leads.push(...creativeLeads[divId]);
                }
            });
            // Remove duplicates
            const uniqueManagers = managers.filter((manager, index, self) =>
                index === self.findIndex(m => m.id === manager.id)
            );
            const uniqueLeads = leads.filter((lead, index, self) =>
                index === self.findIndex(l => l.id === lead.id)
            );
            groupedData[requestType].items.forEach(item => {
                item.creative_managers = uniqueManagers.length > 0 ? uniqueManagers.map(m => ({ id: m.id, name: m.name })) : 'N/A';
                item.creative_leads = uniqueLeads.length > 0 ? uniqueLeads.map(l => ({ id: l.id, name: l.name })) : 'N/A';
            });
            delete groupedData[requestType].divisions; // clean up
        });

        // Convert back to original structure
        const finalData = {};
        Object.keys(groupedData).forEach(requestType => {
            finalData[requestType] = groupedData[requestType].items;
        });


        res.status(200).json({
            success: true,
            data: finalData,
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

module.exports = getAllRequestTypes;