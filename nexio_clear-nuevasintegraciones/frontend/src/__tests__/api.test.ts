/**
 * Tests for frontend API functions using mocked axios.
 * Validates that API calls use the correct endpoints, methods and payloads.
 * Does NOT make real network requests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import axios from 'axios'

// Mock axios module
vi.mock('axios', () => {
  const mockApi = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
    create: vi.fn(),
    defaults: { headers: { common: {} } },
  }
  mockApi.create.mockReturnValue(mockApi)
  return { default: mockApi }
})

// Import API functions AFTER mock is set up
import {
  login,
  getLeads,
  createContact,
  deleteContact,
  getContactsPaged,
  getPipelineSummary,
  getPipelineStages,
  moveLeadStage,
} from '../api'

const mockApi = axios as any

describe('Auth API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('login calls POST /api/auth/login with correct payload', async () => {
    mockApi.post.mockResolvedValueOnce({ data: { access_token: 'tok123', token_type: 'bearer', user: { id: 1 } } })
    const result = await login('admin@test.com', 'Test1234')
    expect(mockApi.post).toHaveBeenCalledWith('/api/auth/login', { email: 'admin@test.com', password: 'Test1234' })
    expect(result.access_token).toBe('tok123')
  })

  it('login propagates error on failure', async () => {
    mockApi.post.mockRejectedValueOnce(new Error('Network error'))
    await expect(login('bad@test.com', 'wrong')).rejects.toThrow('Network error')
  })
})

describe('Leads API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getLeads calls GET /api/leads', async () => {
    mockApi.get.mockResolvedValueOnce({ data: { items: [], total: 0 } })
    await getLeads()
    expect(mockApi.get).toHaveBeenCalledWith('/api/leads', expect.anything())
  })

  it('getLeads passes params correctly', async () => {
    mockApi.get.mockResolvedValueOnce({ data: [] })
    await getLeads({ stage: 'lead', page: 2 })
    expect(mockApi.get).toHaveBeenCalledWith('/api/leads', { params: { stage: 'lead', page: 2 } })
  })

  it('getPipelineSummary calls GET /api/leads/pipeline-summary', async () => {
    mockApi.get.mockResolvedValueOnce({ data: { lead: { count: 5, leads: [] } } })
    await getPipelineSummary()
    expect(mockApi.get).toHaveBeenCalledWith('/api/leads/pipeline-summary', expect.anything())
  })

  it('moveLeadStage calls POST /api/leads/:id/move-stage with stage', async () => {
    mockApi.post.mockResolvedValueOnce({ data: { id: 1, current_stage: 'reunion' } })
    const result = await moveLeadStage(1, { stage: 'reunion' })
    expect(mockApi.post).toHaveBeenCalledWith('/api/leads/1/move-stage', { stage: 'reunion' })
    expect(result.current_stage).toBe('reunion')
  })
})

describe('Contacts API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getContactsPaged calls GET /api/contacts with pagination params', async () => {
    mockApi.get.mockResolvedValueOnce({
      data: { items: [], total: 0, page: 1, pages: 1, page_size: 50 }
    })
    await getContactsPaged({ page: 1, page_size: 50 })
    expect(mockApi.get).toHaveBeenCalledWith('/api/contacts', { params: { page: 1, page_size: 50 } })
  })

  it('createContact calls POST /api/contacts', async () => {
    const payload = { name: 'Juan', phone: '+56912345678' }
    mockApi.post.mockResolvedValueOnce({ data: { id: 5, ...payload } })
    const result = await createContact(payload)
    expect(mockApi.post).toHaveBeenCalledWith('/api/contacts', payload)
    expect(result.id).toBe(5)
  })

  it('deleteContact calls DELETE /api/contacts/:id', async () => {
    mockApi.delete.mockResolvedValueOnce({ data: { ok: true } })
    await deleteContact(7)
    expect(mockApi.delete).toHaveBeenCalledWith('/api/contacts/7')
  })

  it('deleteContact with force=true appends ?force=true', async () => {
    mockApi.delete.mockResolvedValueOnce({ data: { ok: true } })
    await deleteContact(7, true)
    expect(mockApi.delete).toHaveBeenCalledWith('/api/contacts/7?force=true')
  })
})

describe('Pipeline Stages API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getPipelineStages calls GET /api/pipeline-stages', async () => {
    mockApi.get.mockResolvedValueOnce({ data: [] })
    await getPipelineStages()
    expect(mockApi.get).toHaveBeenCalledWith('/api/pipeline-stages')
  })
})
