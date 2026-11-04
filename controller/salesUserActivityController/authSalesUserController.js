const CrudService = require('../../services/crudService');
const { sequelize } = require('../../config/databaseConfig');
const { Division,  Sales, Location, Activity } = require('../../models');
const path = require('path');
const csv = require('csv-parser');
const fs = require('fs');
const { log } = require('console'); 

// const salesService = new CrudService(Sales);
const crypto = require('crypto');
const console = require('console');

function generateToken(id) {
    const payload = {
        id,
        random: crypto.randomBytes(16).toString('hex')
    }; 
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function getIdFromToken(token) {
    try {
        const payload = JSON.parse(
            Buffer.from(token, 'base64url').toString('utf8')
        ); 
        return payload.id;
    } catch {   return null; }
}

async function checkToken(req) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return null;
    }

    const [scheme, token] = authHeader.split(' ');

    if (scheme?.toLowerCase() !== 'bearer' || !token) {
        return null;
    }
    
    let sap_code = getIdFromToken(token);
    
    const salesUserR = await sequelize.query(
            `SELECT 
                sales.*,
                division.title AS division_title
            FROM sales
            INNER JOIN division 
                ON sales.division_id = division.id
            WHERE sales.sap_code = :sap_code`,
            {
                replacements: {
                    sap_code 
                },
                type: sequelize.QueryTypes.SELECT
            }
        );  
    
    return salesUserR;
}

// Login Sales User
const salesLogin = async (req, res) => {
    try { 
        const { identifier, password, loginType } = req.body;

        if (!password || !identifier || !loginType) {
            return res.status(400).json({
                success: false,
                error: 'Identifier, password, and loginType are required'
            });
        }

        const columnMap = {
            email: 'email_id',
            sapcode: 'sap_code',
            empcode: 'emp_code'
        };

        const columnName = columnMap[loginType];

        if (!columnName) {
            return res.status(400).json({
                success: false,
                error: 'Invalid loginType'
            });
        }

        const salesUserResult = await sequelize.query(
            `SELECT 
                sales.*,
                division.title AS division_title
            FROM sales
            INNER JOIN division 
                ON sales.division_id = division.id
            WHERE sales.${columnName} = :identifier
            AND sales.password = :password`,
            {
                replacements: {
                    identifier,
                    password
                },
                type: sequelize.QueryTypes.SELECT
            }
        );

        if (!salesUserResult.length) {
            return res.status(401).json({
                success: false,
                error: 'Invalid login details.'
            });
        }
        // console.log(generateToken(salesUserResult[0].id));
        return res.status(200).json({
            success: true,
            token: generateToken(salesUserResult[0].sap_code),
            data: salesUserResult
            
        });

    } catch (error) {
        console.error('Error in salesLogin:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to retrieve Sales User'
        });
    }
};


const myActivities = async (req, res) => {
    try {
        const loggedInUser = await checkToken(req);  
        // console.log(loggedInUser[0].division_id);
        
        if (!loggedInUser) {
            return res.status(401).json({
                success: false,
                error: 'Invalid login details.'
            });
        }
 
        const divisionId = loggedInUser[0].division_id;
        // Get all Users
        console.log(divisionId);
        
        const activityResult = await sequelize.query(
            `SELECT 
                activity.*,
                division.title AS division_title
            FROM activity
            INNER JOIN division 
                ON activity.division_id = division.id
                WHERE activity.division_id = :divisionId AND activity_status=1 ORDER BY end_date DESC`,
            {
                replacements: {
                    divisionId
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

// module.exportsActivity

// ssoCheck single-sign-on
const ssoCheck = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const user_type = req.query.user_type;

        if (!authHeader) {
            return res.status(401).json({
                success: false,
                error: 'Authorization token required.'
            });
        }

        const [scheme, token] = authHeader.split(' ');

        if (scheme?.toLowerCase() !== 'bearer' || !token) {
            return res.status(401).json({
                success: false,
                error: 'Invalid authorization format.'
            });
        }

        if (!['ho', 'sales'].includes(user_type)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid user type.'
            });
        }

        // Get user ID from login token
        const user_identity_id = getIdFromToken(token);

        if (!user_identity_id) {
            return res.status(401).json({
                success: false,
                error: 'Invalid login token.'
            });
        }

        let userResult = []; 
        
        // HO user validation
        if (user_type === 'ho') {
            userResult = await sequelize.query(
                `SELECT sap_code 
                 FROM sales 
                 WHERE sap_code = :user_identity_id`,
                {
                    replacements: { user_identity_id },
                    type: sequelize.QueryTypes.SELECT
                }
            );
        }

        // Sales user validation
        if (user_type === 'sales') {
            userResult = await sequelize.query(
                `SELECT sap_code 
                 FROM sales 
                 WHERE sap_code = :user_identity_id`,
                {
                    replacements: { user_identity_id },
                    type: sequelize.QueryTypes.SELECT
                }
            );
        }

        

        if (!userResult || userResult.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'User not found.',
                link: 'https://uatdmap.alembicdigilabs.com/field-login'
            });
        }

        // Check active access in activity_access table
        const accessResult = await sequelize.query(
            `SELECT id, access_token, activity_access_link
             FROM activity_access
             WHERE user_identity_id = :user_identity_id
             AND user_type = :user_type
             AND expired_status = 0
             ORDER BY id DESC
             LIMIT 1`,
            {
                replacements: {
                    user_identity_id,
                    user_type
                },
                type: sequelize.QueryTypes.SELECT
            }
        );
 
        
        const InvalidAccess = accessResult.length === 0;

        if (InvalidAccess) {
            return res.status(401).json({
                success: false,
                error: 'Invalid access token details.',
                link: 'https://uatdmap.alembicdigilabs.com/field-login'
            });
        }

        // Expire the access token after successful validation
        const updateResult = await sequelize.query(
            `UPDATE activity_access
             SET expired_status = 1,
                 expired_at = NOW()
             WHERE id = :id
             AND expired_status = 0`,
            {
                replacements: {
                    id: accessResult[0].id
                }
            }
        );

        // Check whether the record was successfully updated
        if (updateResult[1] === 0) {
            return res.status(401).json({
                success: false,
                error: 'Access token already used or expired.',
                link: 'https://uatdmap.alembicdigilabs.com/field-login'
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Valid access token',
            data: {
                user_identity_id,
                user_type,
                activity_access_link: accessResult[0].activity_access_link
            }
        });

    } catch (error) {
        console.error('Error in ssoCheck:', error);

        return res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to ssoCheck'
        });
    }
};


const openActivity = async (req, res) => { // generate activity token and link
    try {
        const activity_id = req.query.activity_id;
        const user_type = req.query.user_type; // hq, sales

        if (!['ho', 'sales'].includes(user_type)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid user type.'
            });
        }
        var loggedInUser= [];
        var user_identityID = 0;
        if (user_type === 'sales') {
            loggedInUser = await checkToken(req);
            if (!loggedInUser) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid login details.'
                });
            } 
            user_identityID = loggedInUser[0].sap_code;
        } 
        if (user_type === 'ho') {
            const authHeader = req.headers.authorization; 
            if (!authHeader) {
                return null;
            } 
            const [scheme, token] = authHeader.split(' '); 
            if (scheme?.toLowerCase() !== 'bearer' || !token) {
                return null;
            } 
            user_identityID  = 123456; // 123456 for ho for testing
        }

        

        const activityResult = await sequelize.query(
            `SELECT * FROM activity WHERE id = :activity_id`,
            {
                replacements: { activity_id },
                type: sequelize.QueryTypes.SELECT
            }
        );

        if (!activityResult.length) {
            return res.status(404).json({
                success: false,
                error: 'Activity not found.'
            });
        }

        // Generate access token
        var at = generateToken(user_identityID);

        var link_part = 'user_type=' + user_type + '&at=' + at;

        var activity_link = activityResult[0].activity_link +
            (activityResult[0].activity_link.includes('?') ? '&' : '?') + link_part;

        var data_link = activityResult[0].data_link +
            (activityResult[0].data_link.includes('?') ? '&' : '?') + link_part;

        // Insert access details into activity_access table
        await sequelize.query(
            `INSERT INTO activity_access
            (
                user_type,
                user_identity_id,
                access_token,
                activity_access_link,
                expired_status,
                expired_at
            )
            VALUES
            (
                :user_type,
                :user_identity_id,
                :access_token,
                :activity_access_link,
                0,
                NULL
            )`,
            {
                replacements: {
                    user_type: user_type,
                    user_identity_id: user_identityID,
                    access_token: at,
                    activity_access_link: activity_link
                },
                type: sequelize.QueryTypes.INSERT
            }
        );

        res.status(200).json({
            success: true,
            data: activityResult,
            activity_link: activity_link,
            data_link: data_link
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


module.exports = {
    salesLogin, myActivities, ssoCheck, openActivity
};