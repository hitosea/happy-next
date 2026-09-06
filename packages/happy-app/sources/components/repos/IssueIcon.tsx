import * as React from 'react';
import { View } from 'react-native';

interface IssueIconProps {
    size: number;
    color: string;
}

export const IssueIcon = React.memo<IssueIconProps>(({ size, color }) => {
    const borderWidth = size * 0.125;
    const dotSize = size * 0.25;
    return (
        <View style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth,
            borderColor: color,
            alignItems: 'center',
            justifyContent: 'center',
        }}>
            <View style={{
                width: dotSize,
                height: dotSize,
                borderRadius: dotSize / 2,
                backgroundColor: color,
            }} />
        </View>
    );
});
IssueIcon.displayName = 'IssueIcon';
