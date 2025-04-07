// This code defines a tool for fetching the status of a Salesforce case by its case number.
// It uses the axios library to make HTTP requests to the Salesforce API and handles the response accordingly.
const axios = require('axios');
const { StructuredTool } = require('@langchain/core/tools');
const { z } = require('zod');
const dotenv = require('dotenv');
dotenv.config();

const SF_ACCESS_TOKEN = process.env.SF_ACCESS_TOKEN;
const BASE_URL = "https://concretio-rajnish-dev-ed.develop.my.salesforce.com/services/apexrest/orderSummary/";

class OrderSummaryStatusTool extends StructuredTool {
    name = "order_summary_status";
    description = "Get the Summary of a order by its order number";
    schema = z.object({
        order_number: z.string().describe("The order number to check"),
    });

    async _call({ order_number }) {
        console.log(`🔍 Tool: Starting case_status for order_number: ${order_number}`);
        try {
            const url = `${BASE_URL}${order_number}`;
            console.log(`🔍 Tool: Making request to URL: ${url}`);
            const headers = {
                "Authorization": `Bearer ${SF_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
            };
            const response = await axios.get(url, { headers });
            console.log('🔍 Tool: Salesforce API response:', JSON.stringify(response.data, null, 2));
            const status = response.text[order_number] || 'Unknown';
            console.log(`🔍 Tool: Extracted status: ${status}`);
            console.log(response.generations[0].text);
            
            return response.generations[0].text;
        } 
        catch (error) {
            console.error('🔍 Tool: Error in case_status:', error.message);
            console.error('🔍 Tool: Error details:', error.response?.data || error);
            return `Error fetching case ${order_number} status: ${error.message}`;
        }
    }
}

module.exports = { OrderSummaryStatusTool };