const CrudService = require('../../services/crudService');
const { sequelize } = require('../../config/databaseConfig');
const {  Division,  Sales, Location } = require('../../models');
const path = require('path');
const csv = require('csv-parser');

const fs = require('fs');

// const salesService = new CrudService(Sales);

// Get all sales Users with divisions 
const getAllSalesUsers = async (req, res) => {
    try {
        console.log(req.user.divisions[0].title);
        
        // const divisionTitles = req.user.divisions.map(item => item.title);
        const divisionId = ['16'];
        // Get all Users
        const salesUsersResult = await sequelize.query(
            `SELECT 
                sales.*,
                division.title AS division_title
            FROM sales
            INNER JOIN division 
                ON sales.division_id = division.id
                WHERE division.id IN (:divisionId)`,
            {
                replacements: {
                    divisionId
                },
                type: sequelize.QueryTypes.SELECT
            }
        );

        res.status(200).json({
            success: true,
            data: salesUsersResult, 
        });

    } catch (error) {
        console.error('Error in getAllSalesUsers:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to retrieve Sales User'
        });
    }
};


const getAllDoctorsData = async (req, res) => {
    try {
        // console.log(req.user.divisions[0].title);

        let myDoctorsResult = [];
        // const divisionTitles = req.user.divisions.map(item => item.title);
        const divisionTitles = ['Aqua'];
        if (req.query.sap_code !== undefined) {
            const sap_code = req.query.sap_code;
             myDoctorsResult = await sequelize.query(
                `SELECT 
                    doctors.*,
                    division.title AS division_title
                FROM doctors
                INNER JOIN division 
                    ON doctors.division_id = division.id
                    WHERE division.title IN (:divisionTitles) AND doctors.sap_code = :sap_code`,
                {
                    replacements: {
                        divisionTitles, sap_code
                    },
                    type: sequelize.QueryTypes.SELECT
                }
            );
        }else{
             myDoctorsResult = await sequelize.query(
                `SELECT 
                    doctors.*,  
                    division.title AS division_title
                FROM doctors
                INNER JOIN division 
                    ON doctors.division_id = division.id
                    WHERE division.title IN (:divisionTitles)`,
                {
                    replacements: {
                        divisionTitles
                    },
                    type: sequelize.QueryTypes.SELECT
                }
            );
        } 

        res.status(200).json({
            success: true,
            data: myDoctorsResult, 
        });

    } catch (error) {
        console.error('Error in myDoctorsResult:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to retrieve Doctors'
        });
    }
};


const uploadCsvFile = async (file, userId, uploadDir) => {
    if (!file) {
        throw new Error('Please upload a file');
    }

    // Only allow CSV files
    if (!file.name.toLowerCase().endsWith('.csv')) {
        throw new Error('Only CSV files are allowed');
    }

    // Create directory if it doesn't exist
    await fs.promises.mkdir(uploadDir, {
        recursive: true
    });

    const fileName = `${Date.now()}-${userId}-${file.name}`;
    const uploadPath = path.join(uploadDir, fileName);

    // Save file
    await file.mv(uploadPath);

    const rows = [];

    await new Promise((resolve, reject) => {

        fs.createReadStream(uploadPath)
            .pipe(csv({
                separator: ','
            }))
            .on('data', (row) => {
                rows.push(row);
            })
            .on('end', () => {
                resolve();
            })
            .on('error', (error) => {
                reject(error);
            });

    });
    
    return {
        fileName,
        uploadPath,
        rows
    };
};


// upload CSV
const uploadSalesUsers = async (req, res) => {
    try {
        console.log(req.files.csv_file);
        const divisionTitles = req.user.divisions.map(item => item.title); 

        const div_id = req.body.division_id;
        const div_name = req.body.division_name;

        const file = req.files?.csv_file;
 
        const uploadDir = path.join(
            __dirname,
            '../../uploads/csv_uploads'
        );

        const uploadedFile = await uploadCsvFile(
            file,
            req.user.id,
            uploadDir
        ); 

        console.log('Total CSV Rows:', uploadedFile.rows.length);

         // CSV file rows import to db ---------

        const transaction = await sequelize.transaction();

        try {

            for (const row of uploadedFile.rows) {

                await sequelize.query(
                    `
                    INSERT INTO sales
                    (
                        emp_code,
                        emp_name,
                        level,
                        hq,
                        region,
                        zone,
                        division_id,
                        sap_code,
                        am_sapcode,
                        rm_sapcode,
                        zm_sapcode,
                        mobile_number,
                        email_id,
                        user_type, email_verified_status, password, account_status, last_login, login_attempts, lock_until, password_changed_at, password_expires_at, created_at, updated_at
                    )
                    VALUES
                    (
                        :emp_code,
                        :emp_name,
                        :level,
                        :hq,
                        :region,
                        :zone,
                        :div_id,
                        :sap_code,
                        :am_sapcode,
                        :rm_sapcode,
                        :zm_sapcode,
                        :mobile_number,
                        :email_id,
                        'sales', '1', :div_name, 'pending', NULL, '0', NULL, NULL, NULL, current_timestamp(), current_timestamp()
                    )
                    `,
                    {
                        replacements: {
                            emp_code: row.emp_code || null,
                            emp_name: row.emp_name || null,
                            level: row.level || null,
                            hq: row.hq || null,
                            region: row.region || null,
                            zone: row.zone || null,
                            div_id: div_id || null, 
                            sap_code: row.sap_code || null,
                            am_sapcode: row.am_sapcode || null,
                            rm_sapcode: row.rm_sapcode || null,
                            zm_sapcode: row.zm_sapcode || null,
                            mobile_number: row.mobile_number || null,
                            email_id: row.email_id || null,
                            div_name: div_name
                        },

                        transaction
                    }
                );
            }

            await transaction.commit();

        } catch (error) {

            await transaction.rollback();

            throw error;
        }

        return res.json({
            success: true,
            message: 'CSV uploaded successfully',
            file_name: uploadedFile.fileName
        });

    } catch (error) {
        console.error('Error in SalesUsers CSV Import:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to Upload Sales User'
        });
    }
};

const uploadDoctors = async (req, res) => {
    try {
        console.log(req.files.csv_file);
        const divisionTitles = req.user.divisions.map(item => item.title); 

        const div_id = req.body.division_id;
        const div_name = req.body.division_name;

        const file = req.files?.csv_file;
 
        const uploadDir = path.join(
            __dirname,
            '../../uploads/csv_uploads'
        );

        const uploadedFile = await uploadCsvFile(
            file,
            req.user.id,
            uploadDir
        ); 

        console.log('Total CSV Rows:', uploadedFile.rows.length);

         // CSV file rows import to db ---------

        const transaction = await sequelize.transaction();

        try {

            for (const row of uploadedFile.rows) {

                await sequelize.query(
                    `
                    INSERT INTO doctors
                    (
                        dr_name, dr_pcode, sap_code, speciality, prescriber_status, division_id
                    )
                    VALUES
                    (
                        :dr_name,
                        :dr_pcode,
                        :sap_code,
                        :speciality,
                        :prescriber_status,
                        :division_id
                    )
                    `,
                    {
                        replacements: { 
                            dr_name: row.dr_name || null,
                            dr_pcode: row.dr_pcode || null,
                            sap_code: row.sap_code || null,
                            speciality: row.speciality || null,
                            prescriber_status: row.prescriber_status || null,
                            division_id: div_id || null
                        },

                        transaction
                    }
                );
            }

            await transaction.commit();

        } catch (error) {

            await transaction.rollback();

            throw error;
        }

        return res.json({
            success: true,
            message: 'CSV uploaded successfully',
            file_name: uploadedFile.fileName
        });

    } catch (error) {
        console.error('Error in Doctor Users CSV Import:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to Upload Doctor Users'
        });
    }
};

// module.exports = getAllSalesUsers;

module.exports = {
    getAllSalesUsers, getAllDoctorsData, uploadSalesUsers, uploadDoctors
};