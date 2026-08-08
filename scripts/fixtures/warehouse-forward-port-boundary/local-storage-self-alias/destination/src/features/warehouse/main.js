const browser = self
const key = 'localStorage'

export const read = () => browser[key].getItem('warehouse')
