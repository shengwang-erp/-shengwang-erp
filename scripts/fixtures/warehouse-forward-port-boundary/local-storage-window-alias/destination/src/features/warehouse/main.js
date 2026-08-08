const key = 'localStorage'
const browser = window

export const read = () => browser[key].getItem('warehouse')
