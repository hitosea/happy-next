import * as React from 'react';
import { View } from 'react-native';
import { Text } from '@/components/StyledText';
import { useUnistyles } from 'react-native-unistyles';
import { getLanguageColor } from '@/data/repoUtils';

interface LanguageDotProps {
    language?: string | null;
    size?: number;
    showLabel?: boolean;
    textSize?: number;
}

export const LanguageDot = React.memo<LanguageDotProps>(({ language, size = 10, showLabel = false, textSize = 12 }) => {
    const { theme } = useUnistyles();
    const color = getLanguageColor(theme, language ?? undefined);
    if (!language && !showLabel) {
        return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
    }
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
            {showLabel && language ? (
                <Text style={{ fontSize: textSize, color: theme.colors.textSecondary }}>{language}</Text>
            ) : null}
        </View>
    );
});
LanguageDot.displayName = 'LanguageDot';
