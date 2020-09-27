from tkinter import *



import sqlite3

con = sqlite3.connect("mydb.db")
cursor = con.cursor()
query0 = """
CREATE TABLE  contactos(contactoid integer primary key autoincrement, nombrecontacto text, numerocontacto integer, correocontacto text); """

query2 = """ SELECT * FROM contactos; """



ventana = Tk()
ventana.title("Agenda VyperCode")


#funciones tkinter
def click_boton(valor):
    global i
    e_texto.insert(i, valor)
    i += 1

#funciones
def insertar (nombrecontacto,numerocontacto,correocontacto):
   query1 = """ INSERT INTO contactos(nombrecontacto, numerocontacto, correocontacto) VALUES (?,?,?); """
   info_tupla = (nombrecontacto,numerocontacto,correocontacto)
   cursor.execute(query1, info_tupla)
   con.commit()
   print("Datos Guardados")

def busquedanombre(nombrecontacto):
    query3 = """ SELECT *  FROM contactos WHERE nombrecontacto = ? """
    cursor.execute(query3, (nombrecontacto,))
    res = cursor.fetchall()
    print(res)

def busquedanumero(numerocontacto):
    query4 = """ SELECT * FROM contactos WHERE numerocontacto = ? """
    cursor.execute(query4, (numerocontacto,))
    res = cursor.fetchall()
    print(res)

def borrar_Cont(nombrecontacto):
    query4 ="""DELETE FROM contactos WHERE nombrecontacto = ? """
    cursor.execute(query4, (nombrecontacto,))

def actualizarcontacto(nombrecontacto,numerocontacto,correocontacto,contactoid):
   query6 = """ UPDATE  contactos SET nombrecontacto = ?, numerocontacto = ?, correocontacto = ? where contactoid = ?; """
   cursor.execute(query6,[nombrecontacto,numerocontacto,correocontacto,contactoid])
   con.commit()

#Botones

boton1 = Button(ventana, text = "Insertar Contacto", width = 15, height = 2 , command = lambda: insertar(nombrecontacto,numerocontacto,correocontacto))
boton2 = Button(ventana, text = "Buscar por nombre", width = 15, height = 2 ,command = lambda: busquedanombre(nombrecontacto))
boton3 = Button(ventana, text = "Buscar por numero", width = 15, height = 2 ,command = lambda:busquedanumero(numerocontacto))
boton4 = Button(ventana, text = "Borrar Contactos", width = 15, height = 2 ,command = lambda: borrar_Cont(nombrecontacto))
boton5 = Button(ventana, text = "Editar Contactos", width = 15, height = 2 ,command = lambda: actualizarcontacto(nombrecontacto,numerocontacto,correocontacto,contactoid))

#Ubicacion en pantalla
boton1.grid(row = 6, column = 0, padx = 5 , pady = 5)
boton2.grid(row = 6, column = 1, padx = 5 , pady = 5)
boton3.grid(row = 6, column = 2, padx = 5 , pady = 5)
boton4.grid(row = 6, column = 3, padx = 5 , pady = 5)
boton5.grid(row = 6, column = 4, padx = 5 , pady = 5)

mainloop()
