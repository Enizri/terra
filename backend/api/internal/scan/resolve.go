package scan

// ResolveHead returns the canonical repo URL, short name, and default-branch
// HEAD SHA without downloading the tarball. Used to serve a commit-keyed
// cache hit before paying for a full scan.
func ResolveHead(rawURL string) (canonicalURL, name, sha string, err error) {
	canonicalURL, name, err = NormalizeURL(rawURL)
	if err != nil {
		return "", "", "", err
	}
	owner, repo, err := ownerRepo(rawURL)
	if err != nil {
		return "", "", "", err
	}
	sha, err = ResolveCommit(owner, repo)
	if err != nil {
		return "", "", "", err
	}
	return canonicalURL, name, sha, nil
}
