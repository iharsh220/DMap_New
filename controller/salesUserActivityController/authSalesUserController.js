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
        
        const activityResult = await sequelize.query(
            `SELECT 
                activity.*,
                division.title AS division_title
            FROM activity
            INNER JOIN division 
                ON activity.division_id = division.id
                WHERE division.id = :divisionId AND activity_status=1 ORDER BY end_date DESC`,
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

module.exports = {
    salesLogin, myActivities
};