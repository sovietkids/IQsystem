document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const terminalOutput = document.getElementById('terminal-output');
    const terminalInput = document.getElementById('terminal-input');
    const clockElement = document.getElementById('clock');
    const fileListElement = document.getElementById('file-list');
    const editorPanel = document.getElementById('file-editor-panel');
    const editorTextarea = document.getElementById('file-editor-textarea');
    const editingFilenameSpan = document.getElementById('editing-filename');
    const viewerPanel = document.getElementById('file-viewer-panel');
    const viewerFilenameSpan = document.getElementById('viewing-filename');
    const viewerContent = document.getElementById('file-viewer-content');

    // --- State ---
    let isEditing = false;
    let editingFile = null;
    let viewerWasVisible = false;
    let virtualFileSystem = {};
    let variables = {}; // 新しい変数を格納するオブジェクト
    const VFS_STORAGE_KEY = 'iqsystem_vfs';
    const ALLOWED_EXTENSIONS = ['.TXT', '.ISH'];

    // --- File System Logic ---
    function loadVFS() {
        const savedVFS = localStorage.getItem(VFS_STORAGE_KEY);
        if (savedVFS) {
            virtualFileSystem = JSON.parse(savedVFS);
        } else {
            virtualFileSystem = {
                'AUTOEXEC.ISH': 'ECHO "Welcome to IQsystem v3.1"\nECHO "Type HELP for command list."',
                'EXAMPLE.TXT': 'This is a standard text file.'
            };
        }
        saveVFS();
    }

    function saveVFS() {
        localStorage.setItem(VFS_STORAGE_KEY, JSON.stringify(virtualFileSystem));
        updateFileList();
    }

    function updateFileList() {
        fileListElement.innerHTML = '';
        for (const filename in virtualFileSystem) {
            const li = document.createElement('li');

            const nameSpan = document.createElement('span');
            nameSpan.className = 'file-name';
            nameSpan.textContent = filename;
            nameSpan.addEventListener('click', () => handleCommand(`VIEW ${filename}`));
            li.appendChild(nameSpan);

            const deleteBtn = document.createElement('span');
            deleteBtn.textContent = '[X]';
            deleteBtn.title = `Delete ${filename}`;
            deleteBtn.className = 'delete-btn';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent the view event on the li from firing
                if (confirm(`Are you sure you want to delete ${filename}?`)) {
                    handleCommand(`RM ${filename}`);
                }
            });
            li.appendChild(deleteBtn);

            fileListElement.appendChild(li);
        }
    }

    // --- Clock ---
    function updateClock() {
        const now = new Date();
        clockElement.textContent = `TIME: ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    }
    setInterval(updateClock, 1000);
    updateClock();

    // --- Terminal Logic ---
    terminalInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const command = terminalInput.value.trim(); // Don't uppercase the whole command
            if (command) {
                printToTerminal(`CMD>${command}`, 'command-output');
                try {
                    await handleCommand(command);
                } catch (error) {
                    printToTerminal(`An unexpected error occurred: ${error.message}`, 'error-output');
                    console.error(error);
                }
                terminalInput.value = '';
            }
        }
    });

    function printToTerminal(text, className = '') {
        const p = document.createElement('p');
        p.textContent = text;
        if (className) p.classList.add(className);
        terminalOutput.appendChild(p);
        terminalOutput.scrollTop = terminalOutput.scrollHeight;
    }

    function isValidFilename(filename) {
        if (!filename) return false;
        const upperCaseFilename = filename.toUpperCase();
        return ALLOWED_EXTENSIONS.some(ext => upperCaseFilename.endsWith(ext));
    }

    async function handleCommand(command) {
        console.log(`Executing command: ${command}`);
        const parts = command.trim().split(/\s+/);
        const cmd = parts[0].toUpperCase();
        const args = parts.slice(1);
        // The filename can contain spaces, so we join the args back.
        // We also need the original case for commands like ECHO.
        const argumentString = args.join(' ');
        const filename = argumentString ? argumentString.toUpperCase() : null;

        if (isEditing && !['SAVE', 'CLOSE'].includes(cmd)) {
            printToTerminal('Currently in editor mode. Use SAVE or CLOSE.', 'error-output');
            return;
        }

        switch (cmd) {
            case 'VAR':
                const varParts = argumentString.split('=').map(s => s.trim());
                if (varParts.length === 2 && varParts[0] && varParts[1]) {
                    const varName = varParts[0].toUpperCase();
                    let varValue = varParts[1];
                    // Check if the value is a reference to another variable
                    if (varValue.startsWith('$')) {
                        const refVarName = varValue.substring(1).toUpperCase();
                        if (variables.hasOwnProperty(refVarName)) {
                            varValue = variables[refVarName];
                        } else {
                            printToTerminal(`ERROR: Variable '${refVarName}' not found.`, 'error-output');
                            return;
                        }
                    }
                    variables[varName] = varValue;
                    printToTerminal(`Variable '${varName}' set to '${varValue}'.`, 'success-output');
                } else {
                    printToTerminal('ERROR: Invalid VAR command. Usage: VAR <variable_name> = <value>', 'error-output');
                }
                break;
            case 'IF':
                const ifMatch = command.match(/^IF\s*\(([^)]+)\)\s*\{(.*)\}$/i);
                if (ifMatch && ifMatch[1] && ifMatch[2]) {
                    const conditionString = ifMatch[1].trim();
                    const commandToExecute = ifMatch[2].trim();

                    let conditionMet = false;
                    const operators = ['===', '>', '<'];
                    let operator = '';
                    for (const op of operators) {
                        if (conditionString.includes(op)) {
                            operator = op;
                            break;
                        }
                    }

                    if (operator) {
                        const conditionParts = conditionString.split(operator).map(s => s.trim());
                        if (conditionParts.length === 2) {
                            let left = conditionParts[0];
                            let right = conditionParts[1];

                            // Resolve variables
                            if (left.startsWith('$')) {
                                const varName = left.substring(1).toUpperCase();
                                left = variables.hasOwnProperty(varName) ? variables[varName] : undefined;
                            }
                            if (right.startsWith('$')) {
                                const varName = right.substring(1).toUpperCase();
                                right = variables.hasOwnProperty(varName) ? variables[varName] : undefined;
                            }

                            if (left === undefined || right === undefined) {
                                printToTerminal('ERROR: Undefined variable in IF condition.', 'error-output');
                                return;
                            }

                            // Attempt numerical comparison if possible
                            const isNumeric = !isNaN(parseFloat(left)) && isFinite(left) && !isNaN(parseFloat(right)) && isFinite(right);

                            if (isNumeric) {
                                left = parseFloat(left);
                                right = parseFloat(right);
                            }

                            switch (operator) {
                                case '===':
                                    conditionMet = (left === right);
                                    break;
                                case '>':
                                    conditionMet = (left > right);
                                    break;
                                case '<':
                                    conditionMet = (left < right);
                                    break;
                            }
                        } else {
                            printToTerminal('ERROR: Invalid IF condition format.', 'error-output');
                            return;
                        }
                    } else {
                        printToTerminal('ERROR: No valid operator found in IF condition. Use =, >, or <.', 'error-output');
                        return;
                    }

                    if (conditionMet) {
                        printToTerminal(`IF condition met. Executing: ${commandToExecute}`, 'success-output');
                        await handleCommand(commandToExecute); // Recursively call handleCommand
                    } else {
                        printToTerminal('IF condition not met.', 'error-output');
                    }
                } else {
                    printToTerminal('ERROR: Invalid IF command. Usage: IF (<condition>) {<command>}', 'error-output');
                }
                break;
            case 'HELP':
                printToTerminal('--- AVAILABLE COMMANDS ---\nVAR [NAME] = [VALUE] - Define or update a variable.\nIF (<CONDITION>) {<COMMAND>} - Execute command based on condition.\nVIEW [F]   - Displays a file in the viewer.\nEDIT [F]   - Edits a file. Allowed extensions: .TXT, .ISH\nRUN [F.ISH]- Executes an IQ-System Shell script.\nLS         - Lists all files.\nRM [F]     - Deletes a file.\nCLS        - Clears the terminal.\nFORMAT     - Wipes all local files.\nECHO [MSG] - Prints a message.');
                break;
            case 'ECHO':
                printToTerminal(argumentString);
                break;
            case 'CLS':
                terminalOutput.innerHTML = '';
                break;
            case 'LS':
                const files = Object.keys(virtualFileSystem);
                printToTerminal(files.length > 0 ? files.join('\n') : 'No files found.');
                break;
            case 'VIEW':
                if (filename && virtualFileSystem.hasOwnProperty(filename)) {
                    if(isEditing) closeEditor(true);
                    openViewer(filename);
                } else {
                    printToTerminal('ERROR: FILE NOT FOUND', 'error-output');
                }
                break;
            case 'RM':
                if (filename && virtualFileSystem.hasOwnProperty(filename)) {
                    delete virtualFileSystem[filename];
                    saveVFS();
                    printToTerminal(`File '${filename}' deleted.`, 'success-output');
                    if(viewerFilenameSpan.textContent === filename) closeViewer();
                    if(editingFilenameSpan.textContent === filename && isEditing) closeEditor();
                } else {
                    printToTerminal('ERROR: FILE NOT FOUND', 'error-output');
                }
                break;
            case 'EDIT':
                if (isValidFilename(filename)) {
                    openEditor(filename);
                } else {
                    printToTerminal('ERROR: Filename must end with .TXT or .ISH', 'error-output');
                }
                break;
            case 'SAVE':
                if (isEditing) saveEditor();
                else printToTerminal('ERROR: NOT IN EDIT MODE', 'error-output');
                break;
            case 'CLOSE':
                if (isEditing) closeEditor();
                else printToTerminal('ERROR: NOT IN EDIT MODE', 'error-output');
                break;
            case 'RUN':
                if (filename && filename.endsWith('.ISH') && virtualFileSystem.hasOwnProperty(filename)) {
                    await runScript(filename);
                } else {
                    printToTerminal('ERROR: Can only run .ISH script files.', 'error-output');
                }
                break;
            case 'FORMAT':
                if (args[0] && args[0].toUpperCase() === 'YES') {
                    virtualFileSystem = {};
                    saveVFS();
                    closeViewer();
                    if(isEditing) closeEditor();
                    printToTerminal('Local storage formatted.', 'success-output');
                } else {
                    printToTerminal('WARNING: This will delete all files. Type \'FORMAT YES\' to confirm.', 'error-output');
                }
                break;
            default:
                if(command) printToTerminal(`UNKNOWN COMMAND: ${cmd}`, 'error-output');
        }
    }

    async function runScript(filename) {
        const scriptContent = virtualFileSystem[filename];
        const commands = scriptContent.split('\n').filter(c => c.trim() !== '');
        printToTerminal(`--- RUNNING SCRIPT ${filename} ---`, 'success-output');
        for (const command of commands) {
            printToTerminal(`> ${command}`, 'command-output');
            await handleCommand(command); // Pass original case command
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        printToTerminal(`--- SCRIPT ${filename} FINISHED ---`, 'success-output');
    }

    // --- Viewer Logic ---
    function openViewer(filename) {
        viewerFilenameSpan.textContent = filename;
        viewerContent.textContent = virtualFileSystem[filename];
        viewerPanel.classList.remove('hidden');
    }

    function closeViewer() {
        viewerPanel.classList.add('hidden');
        viewerFilenameSpan.textContent = '';
        viewerContent.textContent = '';
    }

    // --- Editor Logic ---
    function openEditor(filename) {
        if (!viewerPanel.classList.contains('hidden')) {
            viewerWasVisible = true;
            closeViewer();
        } else {
            viewerWasVisible = false;
        }
        isEditing = true;
        editingFile = filename.toUpperCase();
        const content = virtualFileSystem[editingFile] || '';
        editorTextarea.value = content;
        editingFilenameSpan.textContent = editingFile;
        editorPanel.classList.remove('hidden');
    }

    function saveEditor() {
        virtualFileSystem[editingFile] = editorTextarea.value;
        saveVFS();
        printToTerminal(`File '${editingFile}' saved.`, 'success-output');
        closeEditor();
    }

    function closeEditor(force = false) {
        isEditing = false;
        editingFile = null;
        editorPanel.classList.add('hidden');
        if (viewerWasVisible && !force) {
            const lastViewedFile = viewerFilenameSpan.textContent;
            if(lastViewedFile && virtualFileSystem.hasOwnProperty(lastViewedFile)){
                 openViewer(lastViewedFile);
            }
        }
        terminalInput.focus();
    }

    // --- Initial Boot Sequence ---
    loadVFS();
    handleCommand('RUN AUTOEXEC.ISH').catch(console.error);
});