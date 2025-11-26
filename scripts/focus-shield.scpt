-- Focus Shield AppleScript Interface
-- Claude can use these handlers to communicate with Focus Shield

-- Check if a domain is blocked
on isDomainBlocked(domainName)
	set apiURL to "http://127.0.0.1:8053/api/check/" & domainName
	set result to do shell script "curl -s " & quoted form of apiURL
	return result
end isDomainBlocked

-- Grant access to a domain
on grantAccess(domainName, minutes, reason)
	set apiURL to "http://127.0.0.1:8053/api/grant"
	set jsonBody to "{\"domain\":\"" & domainName & "\",\"minutes\":" & minutes & ",\"reason\":\"" & reason & "\"}"
	set result to do shell script "curl -s -X POST " & quoted form of apiURL & " -H 'Content-Type: application/json' -d " & quoted form of jsonBody
	return result
end grantAccess

-- Block a domain
on blockDomain(domainName)
	set apiURL to "http://127.0.0.1:8053/api/block"
	set jsonBody to "{\"domain\":\"" & domainName & "\"}"
	set result to do shell script "curl -s -X POST " & quoted form of apiURL & " -H 'Content-Type: application/json' -d " & quoted form of jsonBody
	return result
end blockDomain

-- Unblock a domain
on unblockDomain(domainName)
	set apiURL to "http://127.0.0.1:8053/api/block/" & domainName
	set result to do shell script "curl -s -X DELETE " & quoted form of apiURL
	return result
end unblockDomain

-- Get status
on getStatus()
	set result to do shell script "curl -s http://127.0.0.1:8053/status"
	return result
end getStatus

-- Get active allowances
on getAllowances()
	set result to do shell script "curl -s http://127.0.0.1:8053/api/allowances"
	return result
end getAllowances
