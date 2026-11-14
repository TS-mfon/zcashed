import type { Db } from 'mongodb'

type Connection = { uri: string; name: string; database: Promise<Db> }
let connection: Connection | undefined

export function storageBackend(): 'MongoDB' | 'Local file-DB' {
  if (process.env.MONGODB_URI?.trim()) return 'MongoDB'
  if (process.env.NODE_ENV === 'production') throw new Error('MONGODB_URI is required in production')
  return 'Local file-DB'
}

export async function getMongoDatabase(): Promise<Db | null> {
  if (storageBackend() !== 'MongoDB') return null
  const uri = process.env.MONGODB_URI!.trim()
  const name = process.env.MONGODB_DB?.trim() || 'zcashed'
  if (!/^mongodb(?:\+srv)?:\/\//.test(uri)) throw new Error('MONGODB_URI must be a MongoDB connection URI')
  if (!/^[a-zA-Z0-9_-]{1,63}$/.test(name)) throw new Error('MONGODB_DB must be a simple database name')
  if (connection?.uri === uri && connection.name === name) return connection.database
  const database = (async () => {
    let client: import('mongodb').MongoClient | undefined
    try {
      const { MongoClient } = await import('mongodb')
      client = new MongoClient(uri, { maxPoolSize: 10, serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000, tls: process.env.NODE_ENV === 'production' || uri.startsWith('mongodb+srv://') })
      await client.connect()
      return client.db(name)
    } catch {
      if (connection?.uri === uri && connection.name === name) connection = undefined
      if (client) {
        try { await client.close() }
        catch { throw new Error('MongoDB connection and cleanup failed; verify the server configuration') }
      }
      throw new Error('MongoDB connection failed; verify the server configuration')
    }
  })()
  connection = { uri, name, database }
  return database
}
