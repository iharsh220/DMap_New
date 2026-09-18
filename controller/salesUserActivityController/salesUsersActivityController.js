const CrudService = require('../../services/crudService');
const { sequelize } = require('../../config/databaseConfig');
const { Division,  Sales, Location, Activity } = require('../../models');
const path = require('path');
const csv = require('csv-parser');

const fs = require('fs');

// const salesService = new CrudService(Sales);

// Get all Activities with divisions 
const getAllActivities = async (req, res) => {
    try {
        console.log(req.user.divisions[0].title);
        
        const divisionIds = req.user.divisions.map(item => item.id);
        // const divisionId = ['16'];
        // Get all Users
         
        const activityResult = await sequelize.query(
            `SELECT 
                activity.*,
                division.title AS division_title
            FROM activity
            INNER JOIN division 
                ON activity.division_id = division.id
                WHERE division.id IN (:divisionIds)`,
            {
                replacements: {
                    divisionIds
                },
                type: sequelize.QueryTypes.SELECT
            }
        );

        res.status(200).json({
            success: true,
            data: activityResult, 
        });

    } catch (error) {
        console.error('Error in getActivity:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to retrieve Activity'
        });
    }
};


const createActivity = async (req, res) => {
    try {

        console.log(req.user.divisions[0].title);

        var division_id = req.user.divisions[0].id;
        // division_id = 16;
        const created_user_id = req.user.id;

        const {
            visible_to,
            activity_name,
            start_date,
            end_date,
            activity_link,
            data_link,
            description,
            comment,
            activity_status
        } = req.body;


        // Basic validation
        if (!activity_name) {
            return res.status(400).json({
                success: false,  message: 'Activity name is required'
            });
        }

        if (!visible_to) {
            return res.status(400).json({
                success: false,  message: 'Visible to is required'
            });
        }


        const activityResult = await sequelize.query(
            `
            INSERT INTO activity
            (
                created_user_id,
                division_id,
                visible_to,
                activity_name,
                start_date,
                end_date,
                activity_link,
                data_link,
                description,
                comment,
                activity_status,
                created_at,
                updated_at
            )
            VALUES
            (
                :created_user_id,
                :division_id,
                :visible_to,
                :activity_name,
                :start_date,
                :end_date,
                :activity_link,
                :data_link,
                :description,
                :comment,
                :activity_status,
                NOW(),
                NOW()
            )
            `,
            {
                replacements: {
                    created_user_id,
                    division_id,
                    visible_to,
                    activity_name,
                    start_date: start_date || null,
                    end_date: end_date || null,
                    activity_link: activity_link || null,
                    data_link: data_link || null,
                    description: description || null,
                    comment: comment || null,
                    activity_status:
                        activity_status !== undefined
                            ? activity_status
                            : 1
                }
            }
        );


        res.status(201).json({
            success: true,
            message: 'Activity created successfully',
            data: {
                id: activityResult[0],
                created_user_id,
                division_id
            }
        });

    } catch (error) {

        console.error('Error in createActivity:', error);

        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to create Activity'
        });
    }
};

 
const updateActivity = async (req, res) => {
    try {

        const { activity_id } = req.params;

        const division_id = req.user.divisions[0].id;
        const created_user_id = req.user.id;
        
        const {
            visible_to,
            activity_name,
            start_date,
            end_date,
            activity_link,
            data_link,
            description,
            comment,
            activity_status
        } = req.body;


        // Validate activity ID
        if (!activity_id) {
            return res.status(400).json({
                success: false,
                message: 'Activity ID is required'
            });
        }


        // Validate required fields
        if (!activity_name) {
            return res.status(400).json({
                success: false,
                message: 'Activity name is required'
            });
        }

        if (!visible_to) {
            return res.status(400).json({
                success: false,
                message: 'Visible to is required'
            });
        }


        // Check whether activity exists
        const [existingActivity] = await sequelize.query(
            `
            SELECT id
            FROM activity
            WHERE id = :activity_id
            AND division_id = :division_id
            LIMIT 1
            `,
            {
                replacements: {
                    activity_id,
                    division_id
                }, 
                type: sequelize.QueryTypes.SELECT
            }
        );
        console.log("activityid: "+activity_id);

        if (!existingActivity) {
            return res.status(404).json({
                success: false,
                message: 'Activity not found'
            });
        }


        // Update activity
        const [result] = await sequelize.query(
            `
            UPDATE activity
            SET
                visible_to = :visible_to,
                activity_name = :activity_name,
                start_date = :start_date,
                end_date = :end_date,
                activity_link = :activity_link,
                data_link = :data_link,
                description = :description,
                comment = :comment,
                activity_status = :activity_status,
                updated_at = NOW()
            WHERE id = :activity_id
            AND division_id = :division_id
            `,
            {
                replacements: {
                    activity_id,
                    division_id,
                    visible_to,
                    activity_name,
                    start_date: start_date || null,
                    end_date: end_date || null,
                    activity_link: activity_link || null,
                    data_link: data_link || null,
                    description: description || null,
                    comment: comment || null,
                    activity_status: activity_status ?? 1
                },
                type: sequelize.QueryTypes.UPDATE
            }
        );


        res.status(200).json({
            success: true,
            message: 'Activity updated successfully',
            data: {
                activity_id: activity_id
            }
        });

    } catch (error) {

        console.error('Error in updateActivity:', error);

        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to update Activity'
        });
    }
};

 
const deleteActivity = async (req, res) => {
    try {

        const { activity_id } = req.params;

        var division_id = req.user.divisions[0].id;
        //  division_id = 16;
        // Validate activity ID
        if (!activity_id) {
            return res.status(400).json({
                success: false,
                message: 'Activity ID is required'
            });
        }


        // Check whether activity exists
        const [existingActivity] = await sequelize.query(
            `
            SELECT id
            FROM activity
            WHERE id = :activity_id
            AND division_id = :division_id
            LIMIT 1
            `,
            {
                replacements: {
                    activity_id,
                    division_id
                },
                type: sequelize.QueryTypes.SELECT
            }
        );


        if (!existingActivity) {
            return res.status(404).json({
                success: false,
                message: 'Activity not found'
            });
        }


        // Delete activity
        await sequelize.query(
            `
            DELETE FROM activity
            WHERE id = :activity_id
            AND division_id = :division_id
            `,
            {
                replacements: {
                    activity_id,
                    division_id
                },
                type: sequelize.QueryTypes.DELETE
            }
        );


        res.status(200).json({
            success: true,
            message: 'Activity deleted successfully',
            data: {
                activity_id
            }
        });

    } catch (error) {

        console.error('Error in deleteActivity:', error);

        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to delete Activity'
        });
    }
};

// module.exportsActivity

module.exports = {
    getAllActivities, createActivity, updateActivity, deleteActivity
};