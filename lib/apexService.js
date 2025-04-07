const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const SF_ACCESS_TOKEN = process.env.SF_ACCESS_TOKEN;
const BASE_URL = "https://concretio-rajnish-dev-ed.develop.my.salesforce.com";

/**
 * Calls the Apex REST class with a phone number and returns the response.
 * @param {string} phoneNumber - The phone number to send to the Apex class.
 * @returns {Promise<Object>} - The response data from Salesforce.
 */
async function getOrderSummaryStatus(phoneNumber) {
    try {
        const url = `${BASE_URL}/services/apexrest/getOrderDetails`;
        console.log(`🔍 Making POST request to URL: ${url}`);

        const headers = {
            "Authorization": `Bearer ${SF_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
        };

        const requestBody = { phoneNumber };

        const response = await axios.post(url, requestBody, { headers });


        return response.data;
    } catch (error) {
        console.error('❌ Error calling Apex class:', error.message);
        console.error('❌ Error details:', error.response?.data || error);
        return { error: `Error fetching data: ${error.message}` };
    }
}

module.exports = { getOrderSummaryStatus };
