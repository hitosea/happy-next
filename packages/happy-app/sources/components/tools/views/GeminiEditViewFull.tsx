import * as React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ToolViewProps } from './_all';
import { toolFullViewStyles } from '../ToolFullView';
import { ToolDiffView } from '@/components/tools/ToolDiffView';
import { extractEditContent } from './GeminiEditView';
import { trimIdent } from '@/utils/trimIdent';
import { t } from '@/text';
import { LongPressCopy, useCopySelectable } from '@/components/LongPressCopy';

/**
 * Full page for the ACP edit tool (Gemini, Qoder) — the whole diff the chat card shows the head of.
 */
export const GeminiEditViewFull = React.memo<ToolViewProps>(({ tool }) => {
    const selectable = useCopySelectable();

    if (tool.state === 'error' && tool.result) {
        const errorText = String(tool.result);
        return (
            <View style={toolFullViewStyles.section}>
                <View style={toolFullViewStyles.sectionHeader}>
                    <Ionicons name="close-circle" size={20} color="#FF3B30" />
                    <Text style={toolFullViewStyles.sectionTitle}>{t('tools.fullView.error')}</Text>
                </View>
                <LongPressCopy text={errorText}>
                    <View style={toolFullViewStyles.errorContainer}>
                        <Text selectable={selectable} style={toolFullViewStyles.errorText}>{errorText}</Text>
                    </View>
                </LongPressCopy>
            </View>
        );
    }

    const { oldText, newText } = extractEditContent(tool.input);

    return (
        <View style={toolFullViewStyles.sectionFullWidth}>
            <ToolDiffView
                oldText={trimIdent(oldText)}
                newText={trimIdent(newText)}
                style={{ width: '100%' }}
                showLineNumbers={true}
                showPlusMinusSymbols={true}
            />
        </View>
    );
});
