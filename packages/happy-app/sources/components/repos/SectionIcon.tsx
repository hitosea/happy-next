import * as React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { IssueIcon } from './IssueIcon';

export type SectionName =
    | 'code' | 'branch' | 'commits' | 'contrib' | 'issues' | 'pulls' | 'sessions' | 'settings';

const ICON_FOR_SECTION: Record<SectionName, React.ComponentProps<typeof Ionicons>['name']> = {
    code: 'code-slash-outline',
    branch: 'git-branch-outline',
    commits: 'git-commit-outline',
    contrib: 'people-outline',
    issues: 'ellipse-outline',
    pulls: 'git-pull-request-outline',
    sessions: 'sparkles-outline',
    settings: 'settings-outline',
};

interface SectionIconProps {
    section: SectionName;
    /** override Ionicon name */
    name?: React.ComponentProps<typeof Ionicons>['name'];
    /** override color (defaults to theme.colors.repo.section*) */
    color?: string;
    size?: number;
    bubbleSize?: number;
}

export const SectionIcon = React.memo<SectionIconProps>(({ section, name, color, size = 17, bubbleSize = 29 }) => {
    const { theme } = useUnistyles();
    const sectionColor = color ?? (
        section === 'code' || section === 'branch' ? theme.colors.repo.sectionCode
        : section === 'commits' ? theme.colors.repo.sectionCommits
        : section === 'contrib' ? theme.colors.repo.sectionContrib
        : section === 'issues' ? theme.colors.repo.sectionIssues
        : section === 'pulls' ? theme.colors.repo.sectionPulls
        : section === 'sessions' ? theme.colors.repo.sectionSessions
        : theme.colors.repo.sectionSettings
    );
    const icon = !name && section === 'issues'
        ? <IssueIcon size={size} color={sectionColor} />
        : <Ionicons name={name ?? ICON_FOR_SECTION[section]} size={size} color={sectionColor} />;
    return (
        <View
            style={{
                width: bubbleSize,
                height: bubbleSize,
                borderRadius: bubbleSize / 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: sectionColor + '22',
            }}
        >
            {icon}
        </View>
    );
});
SectionIcon.displayName = 'SectionIcon';
