// This code defines a tool for fetching the status of a Salesforce case by its case number.
// It uses the axios library to make HTTP requests to the Salesforce API and handles the response accordingly.
const axios = require('axios');
const { StructuredTool } = require('@langchain/core/tools');
const { z } = require('zod');
const dotenv = require('dotenv');
dotenv.config();

const SF_ACCESS_TOKEN = process.env.SF_ACCESS_TOKEN;
const BASE_URL = "https://concretio-rajnish-dev-ed.develop.my.salesforce.com/services/apexrest/CaseStatus/";

class CaseStatusTool extends StructuredTool {
    name = "case_status";
    description = "Get the status of a Salesforce case by its case number";
    schema = z.object({
        case_number: z.string().describe("The case number to check"),
    });

    async _call({ case_number }) {
        console.log(`🔍 Tool: Starting case_status for case_number: ${case_number}`);
        try {
            const url = `${BASE_URL}${case_number}`;
            console.log(`🔍 Tool: Making request to URL: ${url}`);
            const headers = {
                "Authorization": `Bearer ${SF_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
            };
            const response = await axios.get(url, { headers });
            console.log('🔍 Tool: Salesforce API response:', JSON.stringify(response.data, null, 2));
            const status = response.data[case_number] || 'Unknown';
            console.log(`🔍 Tool: Extracted status: ${status}`);
            return `Case ${case_number} status: ${status}`;
        } catch (error) {
            console.error('🔍 Tool: Error in case_status:', error.message);
            console.error('🔍 Tool: Error details:', error.response?.data || error);
            return `Error fetching case ${case_number} status: ${error.message}`;
        }
    }
}

module.exports = { CaseStatusTool };