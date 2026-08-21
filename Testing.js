const axios = require("axios");
const https = require("https");

const ISSUE_API =
    "https://alembicdigilabs.in/digilabs/dmap/api/datatable/admin/issuedetails/data";

const TASK_API =
    "https://alembicdigilabs.in/digilabs/dmap/api/datatable/admin/taskdetails/data";

const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

const TARGET_FY = "FY 2026-27";

function getFinancialYear(dateString) {
    if (!dateString) {
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

async function getTotals() {
    try {
        const [
            issueResponse,
            taskResponse
        ] = await Promise.all([
            axios.get(ISSUE_API, {
                httpsAgent
            }),
            axios.get(TASK_API, {
                httpsAgent
            })
        ]);

        const issues = issueResponse.data.data || [];
        const tasks = taskResponse.data.data || [];

        const fyIssues = issues.filter(
            item => item.fy === TARGET_FY
        );

        const fyTasks = tasks.filter(
            item => item.fy === TARGET_FY
        );

        const issueTotal = fyIssues.reduce(
            (sum, item) => sum + (Number(item.issue_no_of_work_pages) || 0),
            0
        );

        const taskTotal = fyTasks.reduce(
            (sum, item) => sum + (Number(item.issue_no_of_work_pages) || 0),
            0
        );

        console.log("\n======================================");
        console.log("     FINANCIAL YEAR COMPARISON");
        console.log("======================================");
        console.log("Financial Year:", TARGET_FY);

        console.log("\n--------------------------------------");
        console.log("ISSUE API");
        console.log("--------------------------------------");
        console.log("Total issue_no_of_work_pages:", issueTotal);
        console.log("Total Issue records:", fyIssues.length);

        console.log("\n--------------------------------------");
        console.log("TASK API");
        console.log("--------------------------------------");
        console.log("Total issue_no_of_work_pages:", taskTotal);
        console.log("Total Task records:", fyTasks.length);

        console.log("\n======================================");
        console.log("          COMPARISON");
        console.log("======================================");
        console.log("Issue API:", issueTotal);
        console.log("Task API :", taskTotal);
        console.log("Difference:", issueTotal - taskTotal);
        console.log("Status:", issueTotal === taskTotal ? "MATCH" : "NOT MATCH");
        console.log("======================================\n");

    } catch (error) {
        console.error("API Error:", error.message);
    }
}

getTotals();