const axios = require('axios');
const { StructuredTool } = require('@langchain/core/tools');
const { z } = require('zod');
const dotenv = require('dotenv');
dotenv.config();

const SF_ACCESS_TOKEN = process.env.SF_ACCESS_TOKEN;
const BASE_URL = "https://concretio-rajnish-dev-ed.develop.my.salesforce.com";

class GetOrderSummaryStatus_Ctrl extends StructuredTool {
    name = "order_summary_status";
    description = "Get the Summary of an order by its phone number";
    schema = z.object({
        phone_number: z.string().describe("The phone number to check"),
    });

    async _call({ phone_number }) {
        console.log(`🔍 phone_number: ${phone_number}`);
        try {
            const url = `${BASE_URL}/services/apexrest/getOrderDetails`;
            console.log(`🔍 Tool: Making GET request to URL: ${url}`);

            const headers = {
                "Authorization": `Bearer ${SF_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
            };

            // Sending the phone number in the request body
            const requestBody = { phoneNumber: phone_number };
            console.log(`📤 Tool: Sending request body:`, JSON.stringify(requestBody));

            // Sending POST request with phone_number in body
            const response = await axios.post(url, requestBody, { headers });

            // Debug the full response data
            console.log('🔍 Tool: Salesforce API response:', JSON.stringify(response.data, null, 2));

            // Return the full response (which contains orders)
            return response.data;
        } 
        catch (error) {
            console.error('❌ Tool: Error in order_summary_status:', error.message);
            console.error('❌ Tool: Error details:', error.response?.data || error);
            return `Error fetching order summary: ${error.message}`;
        }
    }
}

module.exports = { GetOrderSummaryStatus_Ctrl };
