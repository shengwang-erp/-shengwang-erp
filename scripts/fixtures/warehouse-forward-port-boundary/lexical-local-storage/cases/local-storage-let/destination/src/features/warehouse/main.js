let localStorage = { getItem: () => 'safe' }

export const read = () => localStorage.getItem('warehouse')
