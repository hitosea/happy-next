import { Platform } from 'react-native';

// Shared spacing, sizing constants (DRY - used by both themes)
const sharedSpacing = {
    // Spacing scale (based on actual usage patterns in codebase)
    margins: {
        xs: 4,   // Tight spacing, status indicators
        sm: 8,   // Small gaps, most common gap value
        md: 12,  // Button gaps, card margins
        lg: 16,  // Most common padding value
        xl: 20,  // Large padding
        xxl: 24, // Section spacing
    },

    // Border radii (based on actual usage patterns in codebase)
    borderRadius: {
        sm: 4,   // Checkboxes (20x20 boxes use 4px corners)
        md: 8,   // Buttons, items (most common - 31 uses)
        lg: 10,  // Input fields (matches "new session panel input fields")
        xl: 12,  // Cards, containers (20 uses)
        xxl: 16, // Main containers
    },

    // Icon sizes (based on actual usage patterns)
    iconSize: {
        small: 12,  // Inline icons (checkmark, lock, status indicators)
        medium: 16, // Section headers, add buttons
        large: 20,  // Action buttons (delete, duplicate, edit) - most common
        xlarge: 24, // Main section icons (desktop, folder)
    },
} as const;

export const lightTheme = {
    dark: false,
    colors: {

        //
        // Main colors
        //

        text: '#000000',
        textDestructive: Platform.select({ ios: '#FF3B30', default: '#F44336' }),
        textSecondary: Platform.select({ ios: '#8E8E93', default: '#49454F' }),
        textLink: '#007AFF',
        deleteAction: '#FF6B6B', // Delete/remove button color
        warningCritical: '#FF3B30',
        warning: '#8E8E93',
        success: '#34C759',
        surface: '#ffffff',
        surfaceRipple: 'rgba(0, 0, 0, 0.08)',
        surfacePressed: '#f0f0f2',
        surfaceSelected: Platform.select({ ios: '#C6C6C8', default: '#eaeaea' }),
        surfacePressedOverlay: Platform.select({ ios: '#D1D1D6', default: 'transparent' }),
        surfaceHigh: '#F8F8F8',
        surfaceHighest: '#f0f0f0',
        divider: Platform.select({ ios: '#eaeaea', default: '#eaeaea' }),
        shadow: {
            color: Platform.select({ default: '#000000', web: 'rgba(0, 0, 0, 0.1)' }),
            opacity: 0.1,
        },
        transparent: 'rgba(0, 0, 0, 0)',

        //
        // System components
        //

        groupped: {
            background: Platform.select({ ios: '#F2F2F7', default: '#F5F5F5' }),
            chevron: Platform.select({ ios: '#C7C7CC', default: '#49454F' }),
            sectionTitle: Platform.select({ ios: '#8E8E93', default: '#49454F' }),
        },
        header: {
            background: '#ffffff',
            tint: '#18171C'
        },
        switch: {
            track: {
                active: Platform.select({ ios: '#34C759', default: '#1976D2' }),
                inactive: '#dddddd',
            },
            thumb: {
                active: '#FFFFFF',
                inactive: '#767577',
            },
        },
        fab: {
            background: '#000000',
            backgroundPressed: '#1a1a1a',
            icon: '#FFFFFF',
        },
        radio: {
            active: '#007AFF',
            inactive: '#C0C0C0',
            dot: '#007AFF',
        },
        modal: {
            border: 'rgba(0, 0, 0, 0.1)'
        },
        button: {
            primary: {
                background: '#000000',
                tint: '#FFFFFF',
                disabled: '#C0C0C0',
            },
            secondary: {
                tint: '#666666',
            }
        },
        input: {
            background: '#F5F5F5',
            text: '#000000',
            placeholder: '#999999',
        },
        box: {
            warning: {
                background: '#FFF8F0',
                border: '#FF9500',
                text: '#FF9500',
            },
            error: {
                background: '#FFF0F0',
                border: '#FF3B30',
                text: '#FF3B30',
            }
        },

        //
        // App components
        //

        status: {
            connected: '#34C759',
            connecting: '#007AFF',
            disconnected: '#999999',
            error: '#FF3B30',
            default: '#8E8E93',
        },

        // Permission mode colors
        permission: {
            default: '#8E8E93',
            acceptEdits: '#007AFF',
            bypass: '#FF9500',
            plan: '#34C759',
            readOnly: '#8B8B8D',
            onFailure: '#FF6B35',
            yolo: '#DC143C',
        },

        // Permission button colors
        permissionButton: {
            allow: {
                background: '#34C759',
                text: '#FFFFFF',
            },
            deny: {
                background: '#FF3B30',
                text: '#FFFFFF',
            },
            allowAll: {
                background: '#007AFF',
                text: '#FFFFFF',
            },
            inactive: {
                background: '#E5E5EA',
                border: '#D1D1D6',
                text: '#8E8E93',
            },
            selected: {
                background: '#F2F2F7',
                border: '#D1D1D6',
                text: '#3C3C43',
            },
        },


        // Diff view
        diff: {
            outline: '#E0E0E0',
            success: '#28A745',
            error: '#DC3545',
            // Traditional diff colors
            addedBg: '#E6FFED',
            addedBorder: '#34D058',
            addedText: '#24292E',
            removedBg: '#FFEEF0',
            removedBorder: '#D73A49',
            removedText: '#24292E',
            contextBg: '#F6F8FA',
            contextText: '#586069',
            lineNumberBg: '#F6F8FA',
            lineNumberText: '#959DA5',
            hunkHeaderBg: '#F1F8FF',
            hunkHeaderText: '#005CC5',
            leadingSpaceDot: '#E8E8E8',
            inlineAddedBg: '#ACFFA6',
            inlineAddedText: '#0A3F0A',
            inlineRemovedBg: '#FFCECB',
            inlineRemovedText: '#5A0A05',
        },

        // Message View colors
        userMessageBackground: '#f0eee6',
        userMessageText: '#000000',
        agentMessageText: '#000000',
        agentEventText: '#666666',

        // Code/Syntax colors
        syntaxKeyword: '#1d4ed8',
        syntaxString: '#059669',
        syntaxComment: '#6b7280',
        syntaxNumber: '#0891b2',
        syntaxFunction: '#9333ea',
        syntaxBracket1: '#ff6b6b',
        syntaxBracket2: '#4ecdc4',
        syntaxBracket3: '#45b7d1',
        syntaxBracket4: '#f7b731',
        syntaxBracket5: '#5f27cd',
        syntaxDefault: '#374151',

        // Git status colors
        gitBranchText: '#6b7280',
        gitFileCountText: '#6b7280',
        gitAddedText: '#22c55e',
        gitRemovedText: '#ef4444',

        // Terminal/Command colors
        terminal: {
            background: '#1E1E1E',
            prompt: '#34C759',
            command: '#E0E0E0',
            stdout: '#E0E0E0',
            stderr: '#FFB86C',
            error: '#FF5555',
            emptyOutput: '#6272A4',
        },

        // GitHub Primer–flavored tokens for the Repos feature
        repo: {
            // Issue / PR state semantics
            stateOpen: '#1A7F37',
            stateClosed: '#8250DF',
            stateMerged: '#8250DF',
            stateDraft: '#6E7781',
            starFilled: '#E3B341',
            // Section icon bubble base colors (pair with +'22' opacity for bg)
            sectionCode: '#0969DA',
            sectionCommits: '#1A7F37',
            sectionIssues: '#0969DA',
            sectionPulls: '#8250DF',
            sectionSessions: '#1A7F37',
            sectionContrib: '#8250DF',
            sectionSettings: '#6E7781',
            // AI Pilot semantic colors
            pilotIdle: '#6E7781',
            pilotRunning: '#0969DA',
            pilotDone: '#1A7F37',
            pilotFailed: '#CF222E',
            // Language dot palette
            languages: {
                TypeScript: '#3178C6',
                JavaScript: '#F1E05A',
                Python: '#3572A5',
                Shell: '#89E051',
                MDX: '#FCB32C',
                Go: '#00ADD8',
                Rust: '#DEA584',
                Java: '#B07219',
                Ruby: '#701516',
                Swift: '#F05138',
                Kotlin: '#A97BFF',
                C: '#555555',
                'C++': '#F34B7D',
                'C#': '#178600',
                HTML: '#E34C26',
                CSS: '#563D7C',
                PHP: '#4F5D95',
                Vue: '#41B883',
                Default: '#8E8E93',
            } as Record<string, string>,
            // Code / file-related
            folderIcon: '#D29922',
            codeBg: '#F6F8FA',
            codeBorder: '#D0D7DE',
            // Lightweight syntax highlighting palette (Primer light)
            syntax: {
                keyword: '#CF222E',
                string: '#0A3069',
                comment: '#6E7781',
                number: '#0550AE',
                punctuation: '#24292F',
            },
            // Rank badges for top contributors
            rankGold: '#BF8700',
            rankSilver: '#6E7781',
            rankBronze: '#974600',
        },

    },

    ...sharedSpacing,
};

export const darkTheme = {
    dark: true,
    colors: {

        //
        // Main colors
        //

        text: '#ffffff',
        textDestructive: Platform.select({ ios: '#FF453A', default: '#F48FB1' }),
        textSecondary: Platform.select({ ios: '#8E8E93', default: '#CAC4D0' }),
        textLink: '#0A84FF',
        deleteAction: '#FF6B6B', // Delete/remove button color (same in both themes)
        warningCritical: '#FF453A',
        warning: '#8E8E93',
        success: '#32D74B',
        surface: Platform.select({ ios: '#18171C', default: '#212121' }),
        surfaceRipple: 'rgba(255, 255, 255, 0.08)',
        surfacePressed: '#2C2C2E',
        surfaceSelected: '#2C2C2E',
        surfacePressedOverlay: Platform.select({ ios: '#2C2C2E', default: 'transparent' }),
        // iOS dark theme is #1c1c1e for items, and #000 for the background
        surfaceHigh: Platform.select({ ios: '#2C2C2E', default: '#171717' }),
        surfaceHighest: Platform.select({ ios: '#38383A', default: '#292929' }),
        divider: Platform.select({ ios: '#38383A', default: '#292929' }),
        shadow: {
            color: Platform.select({ default: '#000000', web: 'rgba(0, 0, 0, 0.1)' }),
            opacity: 0.1,
        },
        transparent: 'rgba(0, 0, 0, 0)',

        //
        // System components
        //

        header: {
            background: Platform.select({ ios: '#18171C', default: '#212121' }),
            tint: '#ffffff'
        },
        switch: {
            track: {
                active: Platform.select({ ios: '#34C759', default: '#1976D2' }),
                inactive: '#3a393f',
            },
            thumb: {
                active: '#FFFFFF',
                inactive: '#767577',
            },
        },
        groupped: {
            background: Platform.select({ ios: '#1C1C1E', default: '#1e1e1e' }),
            chevron: Platform.select({ ios: '#48484A', default: '#CAC4D0' }),
            sectionTitle: Platform.select({ ios: '#8E8E93', default: '#CAC4D0' }),
        },
        fab: {
            background: '#FFFFFF',
            backgroundPressed: '#f0f0f0',
            icon: '#000000',
        },
        radio: {
            active: '#0A84FF',
            inactive: '#48484A',
            dot: '#0A84FF',
        },
        modal: {
            border: 'rgba(255, 255, 255, 0.1)'
        },
        button: {
            primary: {
                background: '#FFFFFF',
                tint: '#000000',
                disabled: '#48484A',
            },
            secondary: {
                tint: '#8E8E93',
            }
        },
        input: {
            background: Platform.select({ ios: '#1C1C1E', default: '#303030' }),
            text: '#FFFFFF',
            placeholder: '#8E8E93',
        },
        box: {
            warning: {
                background: 'rgba(255, 159, 10, 0.15)',
                border: '#FF9F0A',
                text: '#FFAB00',
            },
            error: {
                background: 'rgba(255, 69, 58, 0.15)',
                border: '#FF453A',
                text: '#FF6B6B',
            }
        },

        //
        // App components
        //

        status: { // App Connection Status
            connected: '#34C759',
            connecting: '#FFFFFF',
            disconnected: '#8E8E93',
            error: '#FF453A',
            default: '#8E8E93',
        },

        // Permission mode colors
        permission: {
            default: '#8E8E93',
            acceptEdits: '#0A84FF',
            bypass: '#FF9F0A',
            plan: '#32D74B',
            readOnly: '#98989D',
            onFailure: '#FF7A4C',
            yolo: '#FF453A',
        },

        // Permission button colors
        permissionButton: {
            allow: {
                background: '#32D74B',
                text: '#FFFFFF',
            },
            deny: {
                background: '#FF453A',
                text: '#FFFFFF',
            },
            allowAll: {
                background: '#0A84FF',
                text: '#FFFFFF',
            },
            inactive: {
                background: '#2C2C2E',
                border: '#38383A',
                text: '#8E8E93',
            },
            selected: {
                background: '#1C1C1E',
                border: '#38383A',
                text: '#FFFFFF',
            },
        },


        // Diff view
        diff: {
            outline: '#30363D',
            success: '#3FB950',
            error: '#F85149',
            // Traditional diff colors for dark mode
            addedBg: '#0D2E1F',
            addedBorder: '#3FB950',
            addedText: '#C9D1D9',
            removedBg: '#3F1B23',
            removedBorder: '#F85149',
            removedText: '#C9D1D9',
            contextBg: '#161B22',
            contextText: '#8B949E',
            lineNumberBg: '#161B22',
            lineNumberText: '#6E7681',
            hunkHeaderBg: '#161B22',
            hunkHeaderText: '#58A6FF',
            leadingSpaceDot: '#2A2A2A',
            inlineAddedBg: '#2A5A2A',
            inlineAddedText: '#7AFF7A',
            inlineRemovedBg: '#5A2A2A',
            inlineRemovedText: '#FF7A7A',
        },

        // Message View colors
        userMessageBackground: '#2B3A4C',
        userMessageText: '#FFFFFF',
        agentMessageText: '#FFFFFF',
        agentEventText: '#8E8E93',

        // Code/Syntax colors (brighter for dark mode)
        syntaxKeyword: '#569CD6',
        syntaxString: '#CE9178',
        syntaxComment: '#6A9955',
        syntaxNumber: '#B5CEA8',
        syntaxFunction: '#DCDCAA',
        syntaxBracket1: '#FFD700',
        syntaxBracket2: '#DA70D6',
        syntaxBracket3: '#179FFF',
        syntaxBracket4: '#FF8C00',
        syntaxBracket5: '#00FF00',
        syntaxDefault: '#D4D4D4',

        // Git status colors
        gitBranchText: '#8E8E93',
        gitFileCountText: '#8E8E93',
        gitAddedText: '#34C759',
        gitRemovedText: '#FF453A',

        // Terminal/Command colors
        terminal: {
            background: '#1E1E1E',
            prompt: '#32D74B',
            command: '#E0E0E0',
            stdout: '#E0E0E0',
            stderr: '#FFB86C',
            error: '#FF6B6B',
            emptyOutput: '#7B7B93',
        },

        // GitHub Primer dark tokens for the Repos feature
        repo: {
            stateOpen: '#3FB950',
            stateClosed: '#A371F7',
            stateMerged: '#A371F7',
            stateDraft: '#8B949E',
            starFilled: '#E3B341',
            sectionCode: '#58A6FF',
            sectionCommits: '#3FB950',
            sectionIssues: '#58A6FF',
            sectionPulls: '#A371F7',
            sectionSessions: '#3FB950',
            sectionContrib: '#A371F7',
            sectionSettings: '#8B949E',
            pilotIdle: '#8B949E',
            pilotRunning: '#58A6FF',
            pilotDone: '#3FB950',
            pilotFailed: '#F85149',
            languages: {
                TypeScript: '#4C9AFF',
                JavaScript: '#F1E05A',
                Python: '#79C0FF',
                Shell: '#89E051',
                MDX: '#FCB32C',
                Go: '#00ADD8',
                Rust: '#DEA584',
                Java: '#C88D5A',
                Ruby: '#FF6B74',
                Swift: '#FF8A5B',
                Kotlin: '#B794F6',
                C: '#A8A8A8',
                'C++': '#F8A5C2',
                'C#': '#3FB950',
                HTML: '#FF8A5B',
                CSS: '#A371F7',
                PHP: '#79C0FF',
                Vue: '#41B883',
                Default: '#8B949E',
            } as Record<string, string>,
            folderIcon: '#E3B341',
            codeBg: '#0D1117',
            codeBorder: '#30363D',
            syntax: {
                keyword: '#FF7B72',
                string: '#A5D6FF',
                comment: '#8B949E',
                number: '#79C0FF',
                punctuation: '#C9D1D9',
            },
            rankGold: '#E3B341',
            rankSilver: '#8B949E',
            rankBronze: '#E8A982',
        },

    },

    ...sharedSpacing,
} satisfies typeof lightTheme;

export type Theme = typeof lightTheme;
