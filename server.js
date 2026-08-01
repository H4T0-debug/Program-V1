const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Map requested languages to Glot.io language identifiers
const GLOT_LANGUAGES = {
    'cpp': 'cpp',
    'c++': 'cpp',
    'c': 'c',
    'python': 'python',
    'py': 'python',
    'javascript': 'javascript',
    'js': 'javascript'
};

app.post('/execute', async (req, res) => {
    const { language, code } = req.body;

    const glotLang = GLOT_LANGUAGES[language.toLowerCase()];
    if (!glotLang) {
        return res.status(400).json({ 
            success: false, 
            error: `Language '${language}' is not supported.` 
        });
    }

    // Determine filename based on language
    const fileName = glotLang === 'cpp' ? 'main.cpp' : glotLang === 'python' ? 'main.py' : 'main.js';

    try {
        const response = await axios.post(
            `https://glot.io/api/run/${glotLang}/latest`,
            {
                files: [
                    {
                        name: fileName,
                        content: code
                    }
                ]
            },
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000
            }
        );

        res.json({
            success: true,
            language: language,
            output: response.data.stdout || response.data.stderr || 'Executed with no output.',
            stderr: response.data.stderr || ''
        });

    } catch (err) {
        console.error('Glot execution error:', err.message);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to compile/execute code via remote server.' 
        });
    }
});

app.listen(PORT, () => console.log(`Backend online on port ${PORT}`));