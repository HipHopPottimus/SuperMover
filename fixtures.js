export const FIXTURE_TYPES = {
    '375z': {
        name: 'ChauvetDJ Intimidator 375z',
        channelCount: 15,
        channels: [
            'Pan', 'PanFine', 'Tilt', 'TiltFine', 'PTSpeed',
            'ColorWheel', 'GoboWheel', 'GoboRotation', 'Prism',
            'Focus', 'Dimmer', 'Shutter', 'Function', 'MovementMacros', 'Zoom'
        ],
    },
    '475z': {
        name: 'ChauvetDJ Intimidator 475z',
        channelCount: 16,
        channels: [
            'Pan', 'PanFine', 'Tilt', 'TiltFine', 'PTSpeed',
            'ColorWheel', 'GoboWheel', 'GoboRotation', 'StaticGoboWheel',
            'Prism', 'Focus', 'Zoom', 'Dimmer', 'Shutter', 'Function', 'MovementMacros'
        ],
    },
};

export function getFixtureProfile(type) {
    return FIXTURE_TYPES[type] || FIXTURE_TYPES['375z'];
}
