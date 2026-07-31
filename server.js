//SON
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Primary & Fallback Piston Endpoints
const PISTON_PRIMARY = 'https://emmy-piston.vercel.app/api/v2';
const PISTON_FALLBACK = 'https://emkc.org/api/v2/piston';

app.use(cors());
app.use(express.json());

// Root Health Check Route
app.get('/', (req, res) => {
    res.json({ status: 'online', service: 'Program-V1 Roblox Bridge' });
});

/**
 * GET /runtimes
 * Fetches all available programming languages & versions from Piston API.
 */
app.get('/runtimes', async (req, res) => {
    try {
        const response = await axios.get(`${PISTON_PRIMARY}/runtimes`, { timeout: 15000 });
        res.json({ success: true, runtimes: response.data });
    } catch (error) {
        console.error('Error fetching runtimes:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch available runtimes.' });
    }
});

/**
 * POST /execute
 * Sends source code to Piston API for remote execution.
 */
app.post('/execute', async (req, res) => {
    const { language, version, code } = req.body;

    if (!language || !code) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing required parameters: "language" or "code".' 
        });
    }

    const pistonPayload = {
        language: language,
        version: version || '*', // Default to latest version if not specified
        files: [
            {
                content: code
            }
        ]
    };

    try {
        // Try Primary Endpoint with a 45-second timeout for cold starts
        const response = await axios.post(`${PISTON_PRIMARY}/execute`, pistonPayload, {
            timeout: 45000,
            headers: { 'Content-Type': 'application/json' }
        });

        return res.json({
            success: true,
            language: response.data.language,
            version: response.data.version,
            output: response.data.run?.output || 'Code executed with no output.',
            code: response.data.run?.code, 
            stderr: response.data.run?.stderr
        });

    } catch (primaryError) {
        console.warn('Primary Piston API failed, trying fallback...', primaryError.message);

        // Fallback execution attempt
        try {
            const fallbackResponse = await axios.post(`${PISTON_FALLBACK}/execute`, pistonPayload, {
                timeout: 45000,
                headers: { 'Content-Type': 'application/json' }
            });

            return res.json({
                success: true,
                language: fallbackResponse.data.language,
                version: fallbackResponse.data.version,
                output: fallbackResponse.data.run?.output || 'Code executed with no output.',
                code: fallbackResponse.data.run?.code,
                stderr: fallbackResponse.data.run?.stderr
            });

        } catch (fallbackError) {
            console.error('Execution Error:', fallbackError.response?.data || fallbackError.message);
            return res.status(500).json({ 
                success: false, 
                error: fallbackError.response?.data?.message || primaryError.response?.data?.message || fallbackError.message || 'Execution request failed on remote compiler server.' 
            });
        }
    }
});

app.listen(PORT, () => {
    console.log(`Program-V1 Backend running on port ${PORT}`);
});