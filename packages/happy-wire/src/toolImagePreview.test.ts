import { describe, expect, it } from 'vitest';
import { getToolImagePath } from './toolImagePreview';

describe('getToolImagePath', () => {
    it.each([
        ['view_image', { path: '/tmp/image' }, '/tmp/image'],
        ['view_image', { path: '/tmp/image.png' }, '/tmp/image.png'],
        ['image_generation', { path: '/tmp/generated.png' }, '/tmp/generated.png'],
        ['Read', { file_path: '/tmp/image.png' }, '/tmp/image.png'],
        ['Read', { file_path: '/tmp/IMAGE.JPEG' }, '/tmp/IMAGE.JPEG'],
        ['read', { locations: [{ path: '/tmp/image.webp' }] }, '/tmp/image.webp'],
    ])('extracts the image a %s call reads: %j', (toolName, input, expected) => {
        expect(getToolImagePath(toolName, input)).toBe(expected);
    });

    it.each([
        ['Read', { file_path: '/tmp/image' }],
        ['Read', { file_path: '/tmp/notes.md' }],
        ['Read', { file_path: '/tmp/image.png.txt' }],
        ['Read', { file_path: '/tmp/image.svg' }],
        ['Read', { file_path: '/tmp/image.bmp' }],
        ['read', { locations: [{ path: '/tmp/notes.txt' }] }],
        ['Edit', { file_path: '/tmp/image.png' }],
        ['unknown', { file_path: '/tmp/image.png' }],
        ['view_image', { path: 1 }],
        ['view_image', { path: ' ' }],
        ['view_image', null],
        ['Read', undefined],
    ])('has no image for %s %j', (toolName, input) => {
        expect(getToolImagePath(toolName, input)).toBeNull();
    });
});
