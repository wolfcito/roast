"use server"

const GITHUB_API = "https://api.github.com"

interface FetchRepoTreeOptions {
  owner: string
  repo: string
  path?: string
  depth?: number
}

export async function fetchRepoTreeAction(options: FetchRepoTreeOptions): Promise<any[]> {
  const { owner, repo, path = "", depth = 0 } = options

  if (depth > 3) return []

  const token = process.env.GITHUB_TOKEN
  const headers = token
    ? {
        Authorization: `token ${token}`,
      }
    : {}

  try {
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
      headers,
    })

    if (!response.ok) return []

    const items = await response.json()
    if (!Array.isArray(items)) return []

    let results = items
    for (const item of items) {
      if (item.type === "dir" && depth < 2) {
        const subItems = await fetchRepoTreeAction({
          owner,
          repo,
          path: item.path,
          depth: depth + 1,
        })
        results = results.concat(subItems)
      }
    }
    return results
  } catch (error) {
    console.error("Error fetching repo tree:", error)
    return []
  }
}
