import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { GitHubListView } from '@/components/GitHubListView';
import { t } from '@/text';
import { softHeaderOptions } from '@/components/navigation/softHeader';

export default function GitHubPage() {
    const { theme } = useUnistyles();
    const [repo, setRepo] = React.useState<string | null>(null);
    const repoPickerTriggerRef = React.useRef<(() => void) | null>(null);
    const title = repo ? repo.split('/').pop() || repo : t('github.allRepos');

    return (
        <View style={{ flex: 1 }}>
            <Stack.Screen
                options={{
                    ...softHeaderOptions,
                    headerTitle: title,
                    headerRight: () => (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={repo || title}
                            onPress={() => repoPickerTriggerRef.current?.()}
                            hitSlop={15}
                            style={{ paddingHorizontal: 8 }}
                        >
                            <Ionicons name="swap-horizontal" size={24} color={theme.colors.header.tint} />
                        </Pressable>
                    ),
                }}
            />
            <GitHubListView onRepoChange={setRepo} repoPickerTriggerRef={repoPickerTriggerRef} />
        </View>
    );
}
