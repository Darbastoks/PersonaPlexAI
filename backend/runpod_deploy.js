const axios = require('axios');

const API_KEY = process.env.RUNPOD_API_KEY || '';
const URL = 'https://api.runpod.io/graphql?api_key=' + API_KEY;

async function checkRunPod() {
  try {
    const res = await axios.post(URL, {
      query: `
        query {
          myself { id pubKey }
          endpoints {
            id
            name
            type
          }
        }
      `
    });
    console.log(JSON.stringify(res.data, null, 2));
  } catch(e) {
    console.error(e.response?.data || e.message);
  }
}
checkRunPod();
