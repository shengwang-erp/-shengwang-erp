const values = { localStorage: 'safe' }
const key = 'localStorage'

{
  const values = window
  void values.safe
}

export const read = () => values[key]
