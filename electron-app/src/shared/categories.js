// This function is for backend use or when defaults NEED a userId
export const defaultCategoriesData = (userId) => [
    {
        userId,
        name: 'Work',
        description: 'Writing/editing code, reading, documentation, work-related articles, github repos, looking at AWS, deployment setups, google docs, Figma',
        color: '#3B82F6', // Blue
        isProductive: true,
    },
    {
        userId,
        name: 'Distraction',
        description: 'Looking at tasks and work-unrelated sites like scrolling social media, playing games, random googling, substacks (except if it is directly work-related)',
        color: '#EF4444', // Red
        isProductive: false,
    },
];
// This constant is for frontend comparison, providing default values without userId
export const defaultComparableCategories = [
    {
        name: 'Work',
        description: 'Writing/editing code, reading, documentation, work-related articles, github repos, looking at AWS, deployment setups, google docs, Figma',
        color: '#3B82F6',
        isProductive: true,
    },
    {
        name: 'Distraction',
        description: 'Looking at tasks and work-unrelated sites like scrolling social media, playing games, random googling, substacks (except if it is directly work-related)',
        color: '#EF4444',
        isProductive: false,
    },
];
