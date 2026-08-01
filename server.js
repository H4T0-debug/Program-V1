const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Primary & Fallback Piston Endpoints
const PISTON_PRIMARY = 'https://emmy-piston.vercel.app/api/v2';
const PISTON_FALLBACK = 'https://emkc.org/api/v2/piston';

app.use(cors());
app.use(express.json());

// Default runtimes fallback list in case Piston fails
const DEFAULT_RUNTIMES = [
    { language: 'javascript', version: 'node.js', aliases: ['js', 'node'] },
    { language: 'python', version: '3.x', aliases: ['py', 'python3'] }
];

// Root Health Check Route
app.get('/', (req, res) => {
    res.json({ status: 'online', service: 'Program-V1 Roblox Bridge' });
});

/**
 * Helper function to run code locally on the Render host instance
 * as a safe fallback when external compiler APIs fail.
 */
function executeLocally(language, code) {
    return new Promise((resolve, reject) => {
        const langLower = language.toLowerCase();
        let command = '';

        if (langLower === 'js' || langLower === 'javascript' || langLower === 'node') {
            command = `node -e ${JSON.stringify(code)}`;
        } else if (langLower === 'py' || langLower === 'python' || langLower === 'python3') {
            command = `python3 -c ${JSON.stringify(code)}`;
        } else {
            return reject(new Error(`Local execution not available for '${language}'. Only JS and Python supported locally.`));
        }

        exec(command, { timeout: 5000 }, (error, stdout, stderr) => {
            if (error && error.killed) {
                return resolve({
                    output: 'Execution Timed Out (5s limit reached).',
                    stderr: 'TimeoutError: Process was killed after 5 seconds.'
                });
            }
            resolve({
                output: stdout || stderr || (error ? error.message : 'Code executed with no output.'),
                stderr: stderr || (error ? error.message : '')
            });
        });
    });
}

/**
 * GET /runtimes
 * Fetches all available programming languages & versions from Piston API.
 */
app.get('/runtimes', async (req, res) => {
    try {
        const response = await axios.get(`${PISTON_PRIMARY}/runtimes`, { timeout: 10000 });
        res.json({ success: true, runtimes: response.data });
    } catch (error) {
        console.warn('Primary Piston runtimes failed, trying fallback...');
        try {
            const fallbackRes = await axios.get(`${PISTON_FALLBACK}/runtimes`, { timeout: 10000 });
            res.json({ success: true, runtimes: fallbackRes.data });
        } catch (fallbackErr) {
            console.error('All runtimes endpoints failed. Serving local defaults.');
            // Fallback to local default list so Roblox client doesn't crash
            res.json({ success: true, runtimes: DEFAULT_RUNTIMES });
        }
    }
});

/**
 * POST /execute
 * Sends source code to Piston API, or falls back to local execution.
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

    // 1. Try Primary Piston Endpoint
    try {
        const response = await axios.post(`${PISTON_PRIMARY}/execute`, pistonPayload, {
            timeout: 15000,
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

        // 2. Try Fallback Piston Endpoint
        try {
            const fallbackResponse = await axios.post(`${PISTON_FALLBACK}/execute`, pistonPayload, {
                timeout: 15000,
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
            console.warn('Piston endpoints failed/restricted. Attempting direct local execution fallback...');

            // 3. Fallback to direct local engine execution (for JS & Python)
            try {
                const localResult = await executeLocally(language, code);
                return res.json({
                    success: true,
                    language: language,
                    version: 'local-node',
                    output: localResult.output,
                    code: 0,
                    stderr: localResult.stderr
                });
            } catch (localErr) {
                console.error('All execution methods failed:', localErr.message);
                return res.status(500).json({ 
                    success: false, 
                    error: `Execution failed on remote servers and local engine: ${localErr.message}` 
                });
            }
        }
    }
});

app.listen(PORT, () => {
    console.log(`Program-V1 Backend running on port ${PORT}`);
});
