fetch('https://api.ipify.org?format=json', {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                console.log('✅ CSP 测试成功:', {
                    url: 'https://api.ipify.org?format=json',
                    ip: data.ip,
                    timestamp: new Date().toISOString()
                });
            })
            .catch(err => {
                console.warn('⚠️ CSP 测试失败，可能受限制:', {
                    url: 'https://api.ipify.org?format=json',
                    error: err.message
                });
            });
