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

// Default runtimes fallback list
const DEFAULT_RUNTIMES = [
    { language: 'javascript', version: 'node.js', aliases: ['js', 'node'] },
    { language: 'python', version: '3.x', aliases: ['py', 'python3'] },
    { language: 'cpp', version: 'gcc', aliases: ['c++', 'g++'] },
    { language: 'c', version: 'gcc', aliases: ['gcc'] }
];

// Helper to extract exact error message details from Axios / HTTP responses
function extractRawError(err) {
    if (err.response) {
        // Server responded with a status code outside 2xx range
        const status = err.response.status;
        const statusText = err.response.statusText;
        const data = typeof err.response.data === 'object' ? JSON.stringify(err.response.data) : err.response.data;
        return `[HTTP ${status} ${statusText}]: ${data}`;
    } else if (err.request) {
        // Request was made but no response was received
        return `[No Response Received]: Timeout or Network Connection Refused`;
    } else {
        // Something happened in setting up the request
        return `[Internal Script Error]: ${err.message}`;
    }
}

// Root Health Check Route
app.get('/', (req, res) => {
    res.json({ status: 'online', service: 'Program-V1 Roblox Bridge' });
});

/**
 * Helper function to execute code via Wandbox API (No API key needed, handles C++, Python, JS, C)
 */
async function executeWandbox(language, code) {
    const langLower = language.toLowerCase();
    let compiler = '';

    if (langLower === 'cpp' || langLower === 'c++') compiler = 'gcc-head';
    else if (langLower === 'c') compiler = 'gcc-head-c';
    else if (langLower === 'python' || langLower === 'py' || langLower === 'python3') compiler = 'cpython-head';
    else if (langLower === 'javascript' || langLower === 'js' || langLower === 'node') compiler = 'nodejs-head';
    else {
        throw new Error(`Wandbox compiler mapping not configured for language: '${language}'`);
    }

    const response = await axios.post('https://wandbox.org/api/compile.json', {
        compiler: compiler,
        code: code
    }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 20000
    });

    const stdout = response.data.program_message || '';
    const stderr = response.data.compiler_error || response.data.program_error || response.data.compiler_message || '';

    return {
        output: stdout || stderr || 'Code executed with no output.',
        stderr: stderr,
        code: response.data.status || 0
    };
}

/**
 * Helper function to run code locally on host instance (JS/Python only)
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
            return reject(new Error(`Host environment only has node/python3 installed. '${language}' compiler (g++) missing on host.`));
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
            console.error('All runtimes endpoints failed. Serving default list.');
            res.json({ success: true, runtimes: DEFAULT_RUNTIMES });
        }
    }
});

/**
 * POST /execute
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
        version: version || '*',
        files: [{ content: code }]
    };

    const debugErrors = {};

    // 1. Try Primary Piston
    try {
        const response = await axios.post(`${PISTON_PRIMARY}/execute`, pistonPayload, {
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' }
        });

        return res.json({
            success: true,
            provider: 'Piston-Primary',
            language: response.data.language,
            version: response.data.version,
            output: response.data.run?.output || 'Code executed with no output.',
            code: response.data.run?.code, 
            stderr: response.data.run?.stderr
        });

    } catch (primaryError) {
        const primaryErrMsg = extractRawError(primaryError);
        debugErrors['1_PistonPrimary'] = primaryErrMsg;
        console.warn('[1/4] Primary Piston API failed:', primaryErrMsg);

        // 2. Try Fallback Piston
        try {
            const fallbackResponse = await axios.post(`${PISTON_FALLBACK}/execute`, pistonPayload, {
                timeout: 15000,
                headers: { 'Content-Type': 'application/json' }
            });

            return res.json({
                success: true,
                provider: 'Piston-Fallback',
                language: fallbackResponse.data.language,
                version: fallbackResponse.data.version,
                output: fallbackResponse.data.run?.output || 'Code executed with no output.',
                code: fallbackResponse.data.run?.code,
                stderr: fallbackResponse.data.run?.stderr
            });

        } catch (fallbackError) {
            const fallbackErrMsg = extractRawError(fallbackError);
            debugErrors['2_PistonFallback'] = fallbackErrMsg;
            console.warn('[2/4] Fallback Piston API failed:', fallbackErrMsg);

            // 3. Try Wandbox API (Works great for C++, C, JS, Py without auth)
            try {
                const wandboxResult = await executeWandbox(language, code);
                return res.json({
                    success: true,
                    provider: 'Wandbox-API',
                    language: language,
                    version: 'wandbox-gcc',
                    output: wandboxResult.output,
                    code: wandboxResult.code,
                    stderr: wandboxResult.stderr
                });

            } catch (wandboxError) {
                const wandboxErrMsg = extractRawError(wandboxError);
                debugErrors['3_Wandbox'] = wandboxErrMsg;
                console.warn('[3/4] Wandbox API failed:', wandboxErrMsg);

                // 4. Try Direct Local Execution on Render Host (JS / Python only)
                try {
                    const localResult = await executeLocally(language, code);
                    return res.json({
                        success: true,
                        provider: 'Local-NodeHost',
                        language: language,
                        version: 'local-host',
                        output: localResult.output,
                        code: 0,
                        stderr: localResult.stderr
                    });
                } catch (localErr) {
                    debugErrors['4_LocalHost'] = localErr.message;
                    console.error('[4/4] Direct local execution failed:', localErr.message);

                    // Return exact detailed breakdown of every failing backend layer
                    return res.status(500).json({ 
                        success: false, 
                        error: `ALL COMPILERS FAILED.\n` +
                               `• Piston Primary: ${debugErrors['1_PistonPrimary']}\n` +
                               `• Piston Fallback: ${debugErrors['2_PistonFallback']}\n` +
                               `• Wandbox API: ${debugErrors['3_Wandbox']}\n` +
                               `• Local Host: ${debugErrors['4_LocalHost']}`
                    });
                }
            }
        }
    }
});

app.listen(PORT, () => {
    console.log(`Program-V1 Backend running on port ${PORT}`);
});