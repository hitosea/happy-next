import React from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { themeIcons, type SetiTheme } from '@peoplesgrocers/seti-ui-file-icons';
import { useUnistyles } from 'react-native-unistyles';
import { getSetiFileName, isPresentation } from '@/utils/fileIconName';

interface FileIconProps {
    fileName: string;
    size?: number;
    /** An attached file rather than a repo file: `.key` reads as Keynote, not a private key. */
    attachment?: boolean;
}

const lightColorTheme: SetiTheme = {
    blue: '#268bd2',
    grey: '#6b7280',
    'grey-light': '#9ca3af',
    green: '#059669',
    orange: '#d97706',
    pink: '#db2777',
    purple: '#7c3aed',
    red: '#dc2626',
    white: '#374151',
    yellow: '#eab308',
    ignore: '#9ca3af',
};

const darkColorTheme: SetiTheme = {
    blue: '#268bd2',
    grey: '#eee',
    'grey-light': '#839496',
    green: '#4bae4f',
    orange: '#cb4b16',
    pink: '#d33682',
    purple: '#6c71c4',
    red: '#dc322f',
    white: '#fdf6e3',
    yellow: '#ffcb29',
    ignore: '#586e75',
};

export const FileIcon: React.FC<FileIconProps> = ({ 
    fileName, 
    size = 24, 
    attachment = false,
}) => {
    const { theme } = useUnistyles();
    
    const colorTheme = theme.dark ? darkColorTheme : lightColorTheme;

    if (isPresentation(fileName, attachment)) {
        // Sized so the glyph matches Seti's, which fills about 5/8 of its box
        return (
            <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialCommunityIcons name="microsoft-powerpoint" size={Math.round(size * 0.75)} color={colorTheme.orange} />
            </View>
        );
    }

    const themedGetIcon = themeIcons(colorTheme);
    
    const iconData = themedGetIcon(getSetiFileName(fileName));
    
    return (
        <View style={{ width: size, height: size }}>
            <SvgXml
                xml={iconData.svg}
                width={size}
                height={size}
                fill={iconData.color}
            />
        </View>
    );
};

export default FileIcon;