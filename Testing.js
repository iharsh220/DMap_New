const axios = require("axios");
const fs = require("fs");
const https = require("https");

const WORK_REQUEST_API =
    "https://alembicdigilabs.in/digilabs/dmap/api/datatable/admin/projectsdetails/data";

const TASK_API =
    "https://alembicdigilabs.in/digilabs/dmap/api/datatable/admin/taskdetails/data";

const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

function getFinancialYear(dateString) {
    if (!dateString || dateString.trim() === '') {
        return null;
    }
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
        return null;
    }
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    if (month >= 4) {
        return `FY ${year}-${String(year + 1).slice(-2)}`;
    }
    return `FY ${year - 1}-${String(year).slice(-2)}`;
}

async function getData() {
    try {
        const [workRequestResponse, taskResponse] = await Promise.all([
            axios.get(WORK_REQUEST_API, { httpsAgent }),
            axios.get(TASK_API, { httpsAgent })
        ]);

        const workRequests = workRequestResponse.data.data || [];
        const tasks = taskResponse.data.data || [];

        // Filter tasks with valid task_end_date and group by financial year
        const tasksWithFY = tasks
            .filter(item => item.task_end_date && item.task_end_date.trim() !== '')
            .map(item => ({
                ...item,
                financialYear: getFinancialYear(item.task_end_date)
            }))
            .filter(item => item.financialYear !== null);

        // Group by financial year
        const fyGroups = {};
        tasksWithFY.forEach(item => {
            const fy = item.financialYear;
            if (!fyGroups[fy]) {
                fyGroups[fy] = {
                    tasks: [],
                    totalWorkPages: 0,
                    count: 0
                };
            }
            fyGroups[fy].tasks.push(item);
            fyGroups[fy].totalWorkPages += Number(item.task_no_of_work_pages) || 0;
            fyGroups[fy].count += 1;
        });

        // Sort financial years
        const sortedFYs = Object.keys(fyGroups).sort();

        console.log("============================================");
        console.log("TASK FINANCIAL YEAR BREAKDOWN (by task_end_date)");
        console.log("============================================\n");

        sortedFYs.forEach(fy => {
            const group = fyGroups[fy];
            console.log(`Financial Year: ${fy}`);
            console.log(`  Total Tasks: ${group.count}`);
            console.log(`  Total task_no_of_work_pages: ${group.totalWorkPages}`);
            console.log("");
        });

        // Overall summary
        const totalTasks = tasksWithFY.length;
        const totalWorkPages = tasksWithFY.reduce((sum, item) => sum + (Number(item.task_no_of_work_pages) || 0), 0);

        console.log("--------------------------------------------");
        console.log("OVERALL (excluding null/blank task_end_date)");
        console.log("--------------------------------------------");
        console.log(`Total Tasks: ${totalTasks}`);
        console.log(`Total task_no_of_work_pages: ${totalWorkPages}`);
        console.log("============================================\n");

        // Also show work request comparison if needed
        const workRequestTotal = workRequests.reduce(
            (total, item) => total + (Number(item.task_no_of_work_pages) || 0),
            0
        );

        console.log("WORK REQUEST API (all records)");
        console.log(`Records: ${workRequests.length}`);
        console.log(`Total task_no_of_work_pages: ${workRequestTotal}`);
        console.log("============================================");

    } catch (error) {
        console.error("Error:", error.message);
    }
}

getData();