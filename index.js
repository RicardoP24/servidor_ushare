const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
require('dotenv').config();
const secretKey = process.env.JWT_SECRET; // Use default key if not provided in the environment

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
})

pool.connect((err) => {
  if (err) throw err;
  console.log("Conectado a base de dados")

})

// Middleware para parsear o corpo da requisição como JSON
app.use(express.json());
app.use(cors());
app.use('/healthcheck', async (req, res) => {
  res.status(200).send('ok');
});
// Rota para login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Consulta ao banco de dados para obter o usuário pelo e-mail
    const query = 'SELECT * FROM Utilizador WHERE email = $1';
    const result = await pool.query(query, [email]);

    // Verifica se o usuário foi encontrado
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const user = result.rows[0];

    // Verifica se a senha está correta
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }

    // Gera o token JWT
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);

    res.status(200).json({ user, token });
  } catch (error) {
    console.error('Erro ao fazer login:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});


app.get('/protected', verifyToken, (req, res) => {
  const userId = req.user.id;

  res.json({ id: userId, message: 'This is a protected route' });
});

app.post('/register', async (req, res) => {
  const { nome, tipoUser, email, password, coordenadasMorada, id_dist, id_munic, nif } = req.body;

  try {
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    const query = `
      INSERT INTO Utilizador (nome, tipoUser, email, password, coordenadasMorada, id_dist, id_munic, nif)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;
    const values = [nome, tipoUser, email, hashedPassword, coordenadasMorada, id_dist, id_munic, nif];

    const result = await pool.query(query, values);

    const token = jwt.sign({ id: result.rows[0].id }, process.env.JWT_SECRET);

    res.status(201).json({ ...result.rows[0], token: token });



  } catch (err) {
    console.error('Erro ao registrar usuário:', err);
    res.status(500).send('Erro interno do servidor');
  }
});

function verifyToken(req, res, next) {
  const token = req.headers['authorization'];


  if (!token) {
    return res.status(403).json({ message: 'Token not provided' });
  }

  jwt.verify(token, secretKey, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    req.user = decoded;
    next();
  });
}

app.get('/distritos', async (req, res) => {
  try {
    const query = 'SELECT * FROM Distritos;';
    const result = await pool.query(query);

    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao obter distritos:', err);
    res.status(500).send('Erro interno do servidor');
  }
});

// Rota para obter todos os municípios
app.get('/municipios', async (req, res) => {
  try {
    const query = 'SELECT * FROM Municipio;';
    const result = await pool.query(query);

    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao obter municípios:', err);
    res.status(500).send('Erro interno do servidor');
  }
});

app.post('/anuncios', async (req, res) => {
  const { id_Munic, id_user, titulo, TipoAnuncio, linkImagem, descricao, Estado } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO anuncios (id_munic, id_user, titulo, datadepub, tipoanuncio, linkimagem, descricao, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [id_Munic, id_user, titulo, new Date(), TipoAnuncio, linkImagem, descricao, Estado]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});



app.post('/mensagem', async (req, res) => {
  const { id_user, id_user2, mensagem } = req.body;
  if (!id_user || !id_user2 || !mensagem) {
    return res.status(400).send('id_user, id_user2, and mensagem are required');
  }

  try {
    // Check if the connection already exists in either direction
    const checkResult = await pool.query(
      'SELECT * FROM Conexoes WHERE (id_user1 = $1 AND id_user2 = $2) OR (id_user1 = $2 AND id_user2 = $1)',
      [id_user, id_user2]
    );

    if (checkResult.rows.length > 0) {
      // If the connection already exists, insert the message
      const messageResult = await pool.query(
        'INSERT INTO Mensagens (id_user1, id_user2, mensagem) VALUES ($1, $2, $3) RETURNING *',
        [id_user, id_user2, mensagem]
      );
      return res.status(201).json(messageResult.rows[0]);
    } else {
      // If the connection does not exist, insert the connection in both directions
      const insertConnection = async (user1, user2) => {
        await pool.query(
          'INSERT INTO Conexoes (id_user1, id_user2) VALUES ($1, $2)',
          [user1, user2]
        );
      };

      await Promise.all([
        insertConnection(id_user, id_user2),
      ]);

      const messageResult = await pool.query(
        'INSERT INTO Mensagens (id_user1, id_user2, mensagem) VALUES ($1, $2, $3) RETURNING *',
        [id_user, id_user2, mensagem]
      );

      return res.status(201).json({
        connection: 'Both directions inserted',
        message: messageResult.rows[0]
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});


app.get('/mensagem', async (req, res) => {
  const { id_user, id_user2 } = req.query;

  if (!id_user || !id_user2) {
    return res.status(400).send('id_user and id_user2 are required');
  }

  try {
    const result = await pool.query(
      `SELECT * FROM Mensagens
       WHERE (id_user1 = $1 AND id_user2 = $2) OR (id_user1 = $2 AND id_user2 = $1)
       ORDER BY id ASC`, // Assuming you have an 'id' column for ordering, if not use appropriate column
      [id_user, id_user2]
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

app.get('/conexoes', async (req, res) => {
  const { id_user1 } = req.query;

  if (!id_user1) {
    return res.status(400).send('id_user1 is required');
  }

  try {
    // Get all rows where id_user1 matches either id_user1 or id_user2
    const conexoesQuery = `
      SELECT id_user1, id_user2
      FROM Conexoes
      WHERE id_user1 = $1 OR id_user2 = $1
    `;
    const conexoesResult = await pool.query(conexoesQuery, [id_user1]);

    if (conexoesResult.rows.length === 0) {
      return res.status(404).json({ message: 'No connections found' });
    }

    const userIds = conexoesResult.rows.map(row => {
      return row.id_user1 === parseInt(id_user1) ? row.id_user2 : row.id_user1;
    });
    const userNames = await getUserNames(userIds);

    // Map connections to user names
    const connections = userIds.map(id => {
      const user = userNames.find(user => user.id === id);
      return {
        id_user: id,
        nome: user ? user.nome : 'Unknown'
      };
    });

    res.status(200).json(connections);
  } catch (err) {
    console.error('Erro ao obter conexões:', err);
    res.status(500).send('Erro interno do servidor');
  }
});


// GET endpoint for retrieving anuncios by id_munic
app.get('/anuncios', async (req, res) => {
  const { id_munic } = req.query;
  try {
    const result = await pool.query('SELECT * FROM anuncios WHERE id_munic = $1 ORDER BY id DESC', [id_munic]);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});
// GET endpoint for retrieving anuncios by id_munic
app.get('/utilizador', async (req, res) => {
  const { id_user } = req.query;
  try {
    const result = await pool.query('SELECT * FROM utilizador WHERE id = $1', [id_user]);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

app.get('/comentarios', async (req, res) => {
  const { id_anuncio } = req.query;
  if (!id_anuncio) {
    return res.status(400).send('id_anuncio is required');
  }
  try {
    const result = await pool.query('SELECT * FROM comentarios_anuncios WHERE id_anuncio = $1', [id_anuncio]);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

app.post('/comentarios', async (req, res) => {
  const { id_user, id_anuncio, comentario } = req.body;
  if (!id_user || !id_anuncio || !comentario) {
    return res.status(400).send('id_user, id_anuncio, and comentario are required');
  }
  try {
    const result = await pool.query(
      'INSERT INTO comentarios_anuncios (id_user, id_anuncio, comentario) VALUES ($1, $2, $3) RETURNING *',
      [id_user, id_anuncio, comentario]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

const getUserNames = async (userIds) => {
  const query = 'SELECT id, nome FROM Utilizador WHERE id = ANY($1)';
  const result = await pool.query(query, [userIds]);
  return result.rows;
};


app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);

});
