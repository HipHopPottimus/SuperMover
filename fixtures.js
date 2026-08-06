export const FIXTURE_TYPES = {
    '375z': {
        name: 'Intimidator 375z',
        channelCount: 15,
        channels: [
            'Pan', 'PanFine', 'Tilt', 'TiltFine', 'PTSpeed',
            'ColorWheel', 'GoboWheel', 'GoboRotation', 'Prism',
            'Focus', 'Dimmer', 'Shutter', 'Function', 'MovementMacros', 'Zoom'
        ],
        offsets: {
            Pan: 0, PanFine: 1, Tilt: 2, TiltFine: 3, PTSpeed: 4,
            ColorWheel: 5, GoboWheel: 6, GoboRotation: 7, Prism: 8,
            Focus: 9, Dimmer: 10, Shutter: 11, Function: 12, MovementMacros: 13, Zoom: 14,
        },
        colors: [
            {
                values: [0, 7],
                name: "White",
                color: "#FFFFFF"
            },
            {
                values: [8, 15],
                name: "Medium Bastard Amber",
                color: "#FF7F00"
            },
            {
                values: [16, 23],
                name: "Lime Green",
                color: "#00FF00"
            },
            {
                values: [24, 31],
                name: "Cyan",
                color: "#0099FF"
            },
            {
                values: [32, 39],
                name: "Red",
                color: "#FF0000"
            },
            {
                values: [40, 47],
                name: "Green",
                color: "#00BB00"
            },
            {
                values: [48, 55],
                name: "Magenta",
                color: "#FF00FF"
            },
            {
                values: [56, 63],
                name: "Yellow",
                color: "#FFFF00"
            },
        ],
        hasStaticGobo: false,
    },
    '475z': {
        name: 'Intimidator 475z',
        channelCount: 16,
        channels: [
            'Pan', 'PanFine', 'Tilt', 'TiltFine', 'PTSpeed',
            'ColorWheel', 'GoboWheel', 'GoboRotation', 'StaticGoboWheel',
            'Prism', 'Focus', 'Zoom', 'Dimmer', 'Shutter', 'Function', 'MovementMacros'
        ],
        offsets: {
            Pan: 0, PanFine: 1, Tilt: 2, TiltFine: 3, PTSpeed: 4,
            ColorWheel: 5, GoboWheel: 6, GoboRotation: 7, StaticGoboWheel: 8,
            Prism: 9, Focus: 10, Zoom: 11, Dimmer: 12, Shutter: 13, Function: 14, MovementMacros: 15,
        },
        colors: [
            {
                values: [0, 7],
                name: "White",
                color: "#FFFFFF"
            },
            {
                values: [8, 15],
                name: "Medium Bastard Amber",
                color: "#FF7F00"
            },
            {
                values: [16, 23],
                name: "Lime Green",
                color: "#00FF00"
            },
            {
                values: [24, 31],
                name: "Cyan",
                color: "#0099FF"
            },
            {
                values: [32, 39],
                name: "Red",
                color: "#FF0000"
            },
            {
                values: [40, 47],
                name: "Green",
                color: "#00BB00"
            },
            {
                values: [48, 55],
                name: "Magenta",
                color: "#FF00FF"
            },
        ],
        hasStaticGobo: true,
    },
};

export function lookupColor(profile, colorValue) {
    const color = profile.colors.find(cp => colorValue >= cp.values[0] && colorValue <= cp.values[1]) || profile.colors[0];
    return color;
}

export function getFixtureProfile(type) {
    return FIXTURE_TYPES[type] || FIXTURE_TYPES['375z'];
}

export const CUE_APPLY_GROUPS = [
    { id: 'POS', label: 'POS', title: 'Position', keys: ['Pan', 'PanFine', 'Tilt', 'TiltFine'], defaultOn: true },
    { id: 'SPD', label: 'SPD', title: 'Mover speed', keys: ['PTSpeed'], defaultOn: true },
    { id: 'DM', label: 'DM', title: 'Dimmer', keys: ['Dimmer'], defaultOn: true },
    { id: 'FZ', label: 'FZ', title: 'Focus and zoom', keys: ['Focus', 'Zoom'], defaultOn: true },
    { id: 'CO', label: 'CO', title: 'Colour', keys: ['ColorWheel'], defaultOn: true },
    { id: 'GB', label: 'GB', title: 'Gobo', keys: ['GoboWheel', 'StaticGoboWheel'], defaultOn: true },
    { id: 'ROT', label: 'ROT', title: 'Gobo rotation', keys: ['GoboRotation'], defaultOn: true },
    { id: 'PS', label: 'PS', title: 'Prism', keys: ['Prism'], defaultOn: true },
    { id: 'SH', label: 'SH', title: 'Shutter', keys: ['Shutter'], defaultOn: true },
    { id: 'FN', label: 'FN', title: 'Function', keys: ['Function', 'MovementMacros'], defaultOn: false },
];

export const CUE_FADE_GROUP_IDS = new Set(["POS", "SPD", "DM", "FZ"]);