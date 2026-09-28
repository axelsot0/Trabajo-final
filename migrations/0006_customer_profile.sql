-- Nombre y usuario de Instagram del cliente para mostrarlos a los agentes. El
-- identificador estable sigue siendo el IGSID; el username puede cambiar.
ALTER TABLE customers ADD COLUMN username TEXT;
-- Última consulta a la User Profile API (éxito o fallo): evita repetirla en cada mensaje.
ALTER TABLE customers ADD COLUMN profile_checked_at_utc TEXT;
